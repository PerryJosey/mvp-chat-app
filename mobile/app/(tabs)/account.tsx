import { Alert, Button, StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabaseClient';

export default function AccountScreen() {
  const router = useRouter();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Sign out error', error.message ?? 'Something went wrong');
      return;
    }
    router.replace('/auth');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.subtitle}>You are signed in. You can sign out below.</Text>
      </View>
      <View style={styles.footer}>
        <View style={styles.spacer} />
        <Button title="Sign Out" onPress={handleSignOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#555',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  spacer: {
    flex: 1,
  },
});
