import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, Button, StyleSheet, TextInput, View, Text, Alert } from 'react-native';
import { Bubble, GiftedChat, IMessage, User } from 'react-native-gifted-chat';

import { supabase } from '@/lib/supabaseClient';

// Minimal chat screen: inline email/password auth, find-or-create "General" room,
// and real-time messages for that room via Supabase.

type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

type MessageRow = {
  id: number;
  body: string;
  created_at: string;
  user_id: string | null;
  profiles: Profile | null;
};

const GENERAL_ROOM_NAME = 'General';

export default function ChatScreen() {
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] | null>(
    null
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IMessage[]>([]);

  // Check existing session on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setUser(null);
          return;
        }
        setUser(user);
        await ensureProfile(user.id, user.email ?? undefined);
        const room = await getOrCreateGeneralRoom(user.id);
        setRoomId(room.id);
        await loadMessages(room.id);
        subscribeToMessages(room.id);
      } catch (error) {
        console.error('Error initializing chat', error);
      } finally {
        setLoading(false);
      }
    };

    init();

    return () => {
      // Cleanup subscriptions when screen unmounts
      supabase.removeAllChannels();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureProfile = async (userId: string, email?: string) => {
    const username = email ?? `user-${userId.slice(0, 8)}`;
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, username }, { onConflict: 'id' });
    if (error) {
      console.error('Error upserting profile', error);
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .eq('id', userId)
      .single();

    if (data) {
      setProfile(data as Profile);
    }
  };

  const getOrCreateGeneralRoom = async (userId: string) => {
    // Try to find existing "General" room
    const { data: existing, error: selectError } = await supabase
      .from('rooms')
      .select('id, name')
      .eq('name', GENERAL_ROOM_NAME)
      .limit(1)
      .maybeSingle();

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 is "row not found" for maybeSingle
      throw selectError;
    }

    if (existing) {
      await ensureRoomMember(existing.id, userId);
      return existing as { id: string; name: string | null };
    }

    // Create room if it does not exist
    const { data: created, error: insertError } = await supabase
      .from('rooms')
      .insert({ name: GENERAL_ROOM_NAME, is_direct: false, created_by: userId })
      .select('id, name')
      .single();

    if (insertError || !created) {
      throw insertError;
    }

    await ensureRoomMember(created.id, userId);
    return created as { id: string; name: string | null };
  };

  const ensureRoomMember = async (roomId: string, userId: string) => {
    const { data, error } = await supabase
      .from('room_members')
      .select('room_id, user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking room_members', error);
      return;
    }

    if (!data) {
      const { error: insertError } = await supabase
        .from('room_members')
        .insert({ room_id: roomId, user_id: userId, role: 'member' });
      if (insertError) {
        console.error('Error inserting room_member', insertError);
      }
    }
  };

  const loadMessages = async (roomId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, created_at, user_id, profiles:profiles!messages_user_id_fkey (id, username, avatar_url)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error loading messages', error);
      return;
    }

    const mapped = (data as MessageRow[]).map(toGiftedMessage);
    setMessages(mapped);
  };

  const subscribeToMessages = (roomId: string) => {
    const channel = supabase
      .channel('room-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const newRow = payload.new as MessageRow;

          // For consistency, fetch profile for the new message
          let profile: Profile | null = null;
          if (newRow.user_id) {
            const { data } = await supabase
              .from('profiles')
              .select('id, username, avatar_url')
              .eq('id', newRow.user_id)
              .single();
            if (data) {
              profile = data as Profile;
            }
          }

          const msg = toGiftedMessage({ ...newRow, profiles: profile });
          setMessages((prev) => {
            // If we've already appended this message (e.g. optimistically), skip
            if (prev.some((m) => m._id === msg._id)) {
              return prev;
            }
            return GiftedChat.append(prev, [msg]);
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Subscribed to room messages');
        }
      });

    return channel;
  };

  const toGiftedMessage = (row: MessageRow): IMessage => {
    const createdAt = row.created_at ? new Date(row.created_at) : new Date();
    const profile = row.profiles;

    const user: User = {
      _id: row.user_id ?? 'unknown',
      name: profile?.username ?? 'Unknown',
      avatar: profile?.avatar_url ?? undefined,
    };

    return {
      _id: row.id,
      text: row.body,
      createdAt,
      user,
    };
  };

  const handleAuth = async () => {
    setAuthLoading(true);
    try {
      const emailTrimmed = email.trim();
      if (!emailTrimmed || !password) {
        Alert.alert('Missing info', 'Please enter email and password');
        return;
      }

      // Try sign in first
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });

      let authedUser = signInData.user;

      if (signInError && signInError.message.includes('Invalid login credentials')) {
        // Try sign up if sign in fails with invalid credentials
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: emailTrimmed,
          password,
        });
        if (signUpError) {
          throw signUpError;
        }
        authedUser = signUpData.user;
      } else if (signInError) {
        throw signInError;
      }

      if (!authedUser) {
        Alert.alert('Auth error', 'No user returned from Supabase');
        return;
      }

      setUser(authedUser);
      await ensureProfile(authedUser.id, authedUser.email ?? undefined);
      const room = await getOrCreateGeneralRoom(authedUser.id);
      setRoomId(room.id);
      await loadMessages(room.id);
      subscribeToMessages(room.id);
    } catch (error: any) {
      console.error('Auth error', error);
      Alert.alert('Auth error', error.message ?? 'Something went wrong');
    } finally {
      setAuthLoading(false);
      setLoading(false);
    }
  };

  const handleSend = useCallback(
    async (newMessages: IMessage[] = []) => {
      if (!roomId || !user) return;

      const message = newMessages[0];
      const text = message?.text;
      if (!text) return;

      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          user_id: user.id,
          body: text,
        })
        .select('id, body, created_at, user_id')
        .single();

      if (error) {
        console.error('Error sending message', error);
        return;
      }

      // Optimistically append the sent message for this client
      const optimistic: IMessage = {
        _id: data.id,
        text: data.body,
        createdAt: data.created_at ? new Date(data.created_at) : new Date(),
        user: {
          _id: user.id,
          name: profile?.username ?? user.email ?? 'You',
        },
      };

      setMessages((prev) => GiftedChat.append(prev, [optimistic]));
    },
    [roomId, user, profile]
  );

  if (loading && !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.authContainer}>
        <Text style={styles.authTitle}>Sign in to chat</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Button title={authLoading ? 'Signing in...' : 'Sign in / Sign up'} onPress={handleAuth} disabled={authLoading} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <GiftedChat
        messages={messages}
        onSend={handleSend}
        user={{ _id: user.id, name: profile?.username ?? user.email ?? 'You' }}
        renderBubble={(props) => (
          <Bubble
            {...props}
            wrapperStyle={{
              right: {
                backgroundColor: '#0a7ea4',
              },
              left: {
                backgroundColor: '#e5e5ea',
              },
            }}
            textStyle={{
              right: {
                color: '#fff',
              },
              left: {
                color: '#000',
              },
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    gap: 12,
  },
  authTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
  },
});
