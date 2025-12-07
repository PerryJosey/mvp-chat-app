import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabaseClient';

// Simple list of other authorized users (profiles). Selecting one will
// find-or-create a direct room and navigate to the chat tab for that room.

type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

export default function UsersScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace('/auth');
          return;
        }

        setCurrentUserId(user.id);
        await loadProfiles(user.id);
      } catch (error) {
        console.error('Error loading users', error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [router]);

  const loadProfiles = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .neq('id', userId)
      .order('username', { ascending: true });

    if (error) {
      console.error('Error loading profiles', error);
      return;
    }

    setProfiles((data ?? []) as Profile[]);
  };

  const ensureRoomMember = useCallback(async (roomId: string, userId: string) => {
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
      if (insertError && insertError.code !== '23505') {
        // 23505 = duplicate key, which is safe to ignore here
        console.error('Error inserting room_member', insertError);
      }
    }
  }, []);

  const getOrCreateDirectRoom = useCallback(
    async (userId: string, otherUserId: string) => {
      const participantsKey = [userId, otherUserId].sort().join(':');

      const { data: existing, error: selectError } = await supabase
        .from('rooms')
        .select('id, name, is_direct')
        .eq('is_direct', true)
        .eq('name', participantsKey)
        .limit(1)
        .maybeSingle();

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError;
      }

      if (existing) {
        await ensureRoomMember(existing.id, userId);
        await ensureRoomMember(existing.id, otherUserId);
        return existing.id as string;
      }

      const { data: created, error: insertError } = await supabase
        .from('rooms')
        .insert({ name: participantsKey, is_direct: true, created_by: userId })
        .select('id')
        .single();

      if (insertError || !created) {
        throw insertError;
      }

      await ensureRoomMember(created.id, userId);
      await ensureRoomMember(created.id, otherUserId);

      return created.id as string;
    },
    [ensureRoomMember]
  );

  const handleSelectUser = useCallback(
    async (profile: Profile) => {
      if (!currentUserId) return;

      try {
        const roomId = await getOrCreateDirectRoom(currentUserId, profile.id);
        router.push({ pathname: '/(tabs)/chat', params: { roomId } });
      } catch (error) {
        console.error('Error opening direct room', error);
      }
    },
    [currentUserId, getOrCreateDirectRoom, router]
  );

  const getInitial = (profile: Profile) => {
    const source = profile.username ?? '';
    const trimmed = source.trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
  };

  const getColorForId = (id: string) => {
    const colors = ['#0a7ea4', '#f97316', '#22c55e', '#6366f1', '#ec4899', '#eab308'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return colors[hash % colors.length];
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Authorized users</Text>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={profiles}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => handleSelectUser(item)}>
            {item.avatar_url ? (
              <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.avatarPlaceholder,
                  { backgroundColor: getColorForId(item.id) },
                ]}>
                <Text style={styles.avatarInitial}>{getInitial(item)}</Text>
              </View>
            )}
            <Text style={styles.username}>{item.username ?? 'Unknown user'}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>No other users yet.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#ccc',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    color: '#fff',
    fontWeight: '600',
  },
  username: {
    fontSize: 16,
  },
  empty: {
    padding: 16,
    alignItems: 'center',
  },
});

