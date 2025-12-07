import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabaseClient';

export default function AuthScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const ensureProfile = async (userId: string, email?: string | null) => {
    const username = email ?? `user-${userId.slice(0, 8)}`;
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, username }, { onConflict: 'id' });

    if (error) {
      console.error('Error upserting profile from auth', error);
    }
  };

  const handleAuth = async () => {
    setLoading(true);
    try {
      const emailTrimmed = email.trim();
      if (!emailTrimmed || !password) {
        Alert.alert('Missing info', 'Please enter email and password');
        return;
      }

      // 1) Try to sign in existing user
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailTrimmed,
        password,
      });

      if (!signInError && signInData.user) {
        // Existing confirmed user: ensure profile then go to chat
        await ensureProfile(signInData.user.id, signInData.user.email);
        router.replace('/(tabs)/chat');
        return;
      }

      const invalidCreds =
        signInError &&
        (signInError.message?.toLowerCase().includes('invalid login credentials') ||
          signInError.status === 400);

      if (!invalidCreds && signInError) {
        throw signInError;
      }

      // 2) Sign up new user (email confirmation likely required)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailTrimmed,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!signUpData.user || !signUpData.session) {
        Alert.alert(
          'Check your email',
          "We've sent you a confirmation link. Please verify your email, then return here and sign in."
        );
        return;
      }

      // If email confirmation disabled, treat as logged-in: ensure profile and go to chat
      await ensureProfile(signUpData.user.id, signUpData.user.email);
      router.replace('/(tabs)/chat');
    } catch (error: any) {
      console.error('Auth error', error);
      Alert.alert('Auth error', error.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
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
      <Button title={loading ? 'Signing in...' : 'Sign in / Sign up'} onPress={handleAuth} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
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
