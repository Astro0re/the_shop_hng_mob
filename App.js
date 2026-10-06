import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Image, Keyboard, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAccountStore, mergeGuestBasket, setBasketItem, setSavedItem } from '@the-shop/account-store';
import { supabase, supabaseConfigIssue } from './src/supabase.js';

WebBrowser.maybeCompleteAuthSession();

const guestBasketKey = 'the-shop-mobile-guest-basket';
const categories = ['All things', 'Furniture', 'Electronics', 'Home & living', 'Clothing', 'Books & hobbies'];
const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const green = '#52684f';

function Tab({ title, icon, active, badge, onPress }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.tab}>
    <Text style={[styles.tabIcon, active && styles.tabActive]}>{icon}</Text>
    <Text style={[styles.tabText, active && styles.tabActive]}>{title}</Text>
    {!!badge && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badge}</Text></View>}
  </Pressable>;
}

function ShopApp() {
  const [session, setSession] = useState(null);
  const [screen, setScreen] = useState('Discover');
  const [returnScreen, setReturnScreen] = useState('Account');
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All things');
  const [loadingItems, setLoadingItems] = useState(true);
  const [listingError, setListingError] = useState('');
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [accountOwner, setAccountOwner] = useState(null);
  const activeUserId = useRef(null);

  const showNotice = useCallback((message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 5000);
  }, []);

  const refreshListings = useCallback(async () => {
    if (!supabase) throw new Error(supabaseConfigIssue || 'Supabase is not configured for this build.');
    const { data, error } = await supabase.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false });
    if (error) throw error;
    setItems((data || []).map((item) => ({ ...item, isDemo: false })));
    setListingError('');
  }, []);

  useEffect(() => {
    if (!supabase) {
      setListingError(supabaseConfigIssue || 'Supabase is not configured for this build.');
      setLoadingItems(false);
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (active) setSession(currentSession);
    }).catch((error) => showNotice(error.message || 'Could not restore your session.'));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      const nextUserId = currentSession?.user?.id || null;
      if (nextUserId && activeUserId.current && activeUserId.current !== nextUserId) {
        setCart([]);
        setFavorites([]);
        setAccountOwner(null);
      }
      if (!currentSession) {
        setAccountOwner(null);
        setCart([]);
        setFavorites([]);
        AsyncStorage.removeItem(guestBasketKey).catch(() => {});
      }
      activeUserId.current = nextUserId;
    });
    refreshListings().catch((error) => {
      setListingError(error.message || 'Could not load listings. Check your connection and retry.');
    }).finally(() => setLoadingItems(false));
    return () => { active = false; subscription.unsubscribe(); };
  }, [refreshListings, showNotice]);

  useEffect(() => {
    let active = true;
    if (!session?.user?.id || !supabase) {
      setLoadingAccount(false);
      setAccountOwner(null);
      AsyncStorage.getItem(guestBasketKey).then((raw) => {
        if (active) setCart(raw ? JSON.parse(raw) : []);
      }).catch(() => { if (active) setCart([]); });
      return () => { active = false; };
    }

    const userId = session.user.id;
    setLoadingAccount(true);
    setAccountOwner(null);
    setFavorites([]);
    (async () => {
      let guestItems = cart;
      if (guestItems.length === 0) {
        const rawGuestItems = await AsyncStorage.getItem(guestBasketKey);
        if (rawGuestItems) guestItems = JSON.parse(rawGuestItems);
      }
      await mergeGuestBasket(supabase, userId, guestItems);
      const account = await loadAccountStore(supabase, userId);
      if (!active) return;
      setCart(account.cart);
      setFavorites(account.favorites);
      setAccountOwner(userId);
      await AsyncStorage.removeItem(guestBasketKey);
      if (guestItems.length) setScreen('Basket');
    })().catch((error) => {
      if (active) showNotice(`Could not sync your account basket: ${error.message || 'Please try again.'}`);
    }).finally(() => { if (active) setLoadingAccount(false); });
    return () => { active = false; };
    // The guest basket is intentionally captured once when an account session becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, showNotice]);

  useEffect(() => {
    if (!session?.user?.id || accountOwner !== session.user.id || !supabase) return undefined;
    let active = true;
    let refreshingAccount = false;
    const refreshAccount = async () => {
      if (refreshingAccount) return;
      refreshingAccount = true;
      try {
        const state = await loadAccountStore(supabase, session.user.id);
        if (active) { setCart(state.cart); setFavorites(state.favorites); }
      } catch (error) {
        if (active) showNotice(`Account sync failed: ${error.message || 'Reconnect and try again.'}`);
      } finally { refreshingAccount = false; }
    };
    const channel = supabase.channel(`mobile-account-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'basket_items', filter: `user_id=eq.${session.user.id}` }, refreshAccount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_items', filter: `user_id=eq.${session.user.id}` }, refreshAccount)
      .subscribe();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshAccount();
        refreshListings().catch((error) => showNotice(error.message || 'Could not refresh listings.'));
      }
    });
    return () => { active = false; appStateSubscription.remove(); supabase.removeChannel(channel); };
  }, [session?.user?.id, accountOwner, refreshListings, showNotice]);

  useEffect(() => {
    if (!session) AsyncStorage.setItem(guestBasketKey, JSON.stringify(cart)).catch(() => showNotice('Guest basket could not be saved on this device.'));
  }, [cart, session, showNotice]);

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesCategory = category === 'All things' || item.category === category;
    const matchesQuery = !query.trim() || `${item.title} ${item.category} ${item.location}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesCategory && matchesQuery;
  }), [items, category, query]);
  const savedItems = useMemo(() => items.filter((item) => favorites.includes(item.id)), [items, favorites]);

  async function signInWithGoogle() {
    if (!supabase) { showNotice(supabaseConfigIssue || 'Supabase is not configured.'); return; }
    Keyboard.dismiss();
    setBusy(true);
    try {
      const scheme = process.env.EXPO_PUBLIC_APP_SCHEME || 'the-shop-dev';
      const redirectTo = AuthSession.makeRedirectUri({ scheme, path: 'auth/callback' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Google sign-in did not return an authorization URL.');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return;
      const { queryParams } = Linking.parse(result.url);
      if (queryParams?.error_description) throw new Error(String(queryParams.error_description));
      if (!queryParams?.code) throw new Error('The sign-in callback did not include an authorization code. Check the mobile redirect URL in Supabase.');
      const { data: authData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(String(queryParams.code));
      if (exchangeError) throw exchangeError;
      const signedInUser = authData.session?.user;
      if (signedInUser?.email && process.env.EXPO_PUBLIC_API_URL) {
        const createdAt = Date.parse(signedInUser.created_at || '');
        const signedInAt = Date.parse(signedInUser.last_sign_in_at || '');
        const action = Number.isFinite(createdAt) && Number.isFinite(signedInAt) && Math.abs(signedInAt - createdAt) < 60_000 ? 'signup' : 'signin';
        fetch(`${process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')}/api/auth-confirmations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authData.session.access_token}` },
          body: JSON.stringify({ action }),
        }).then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.sent) showNotice('You’re signed in, but the confirmation email could not be delivered.');
        }).catch(() => showNotice('You’re signed in. The confirmation email service could not be reached.'));
      }
      setScreen(returnScreen || 'Account');
    } catch (error) {
      showNotice(error.message || 'Google sign-in could not be completed.');
    } finally { setBusy(false); }
  }

  async function addToBasket(item) {
    if (session?.user?.id && session.user.id === item.seller_id) { showNotice('This is your listing.'); return; }
    if (session?.user && loadingAccount) { showNotice('Your basket is still syncing. Please try again in a moment.'); return; }
    if (cart.some((entry) => entry.id === item.id)) { setScreen('Basket'); return; }
    setBusy(true);
    try {
      if (session?.user) await setBasketItem(supabase, session.user.id, item.id, true);
      setCart((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
      setScreen('Basket');
    } catch (error) { showNotice(`Could not add this find: ${error.message || 'Please retry.'}`); }
    finally { setBusy(false); }
  }

  async function removeFromBasket(itemId) {
    try {
      if (session?.user) await setBasketItem(supabase, session.user.id, itemId, false);
      setCart((current) => current.filter((item) => item.id !== itemId));
    } catch (error) { showNotice(`Could not sync this basket change: ${error.message || 'Please retry.'}`); }
  }

  async function toggleSaved(itemId) {
    if (!session?.user) {
      setReturnScreen('Saved');
      setScreen('Account');
      showNotice('Sign in to keep your saved finds across devices.');
      return;
    }
    if (loadingAccount) { showNotice('Your saved finds are still syncing.'); return; }
    const isSaved = !favorites.includes(itemId);
    try {
      await setSavedItem(supabase, session.user.id, itemId, isSaved);
      setFavorites((current) => isSaved ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId));
    } catch (error) { showNotice(`Could not sync this saved find: ${error.message || 'Please retry.'}`); }
  }

  async function sendInquiry() {
    if (!session?.user) {
      setReturnScreen('Basket');
      setScreen('Account');
      showNotice('Sign in to contact the sellers. Your basket will sync to your account.');
      return;
    }
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) { showNotice('Set EXPO_PUBLIC_API_URL in mobile/.env to contact the sellers.'); return; }
    if (loadingAccount) { showNotice('Your basket is still syncing. Please try again.'); return; }
    setBusy(true);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) throw new Error('Your sign-in expired. Sign in again to continue.');
      for (const item of cart) {
        const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSession.access_token}` },
          body: JSON.stringify({ action: 'purchase_inquiry', listingId: item.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not contact a seller.');
        if (!result.sent) throw new Error('Email delivery is not configured. Your basket is still saved.');
        await setBasketItem(supabase, currentSession.user.id, item.id, false);
        setCart((current) => current.filter((entry) => entry.id !== item.id));
      }
      showNotice('Your inquiry is confirmed. No payment was taken and the finds are not reserved.');
      setScreen('Discover');
    } catch (error) { showNotice(error.message || 'Could not contact the sellers.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) { showNotice(error.message); return; }
    setSession(null);
    setFavorites([]);
    setScreen('Discover');
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshListings();
      if (session?.user) {
        const state = await loadAccountStore(supabase, session.user.id);
        setCart(state.cart);
        setFavorites(state.favorites);
      }
    } catch (error) {
      setListingError(error.message || 'Refresh failed. Check your connection and retry.');
      showNotice(error.message || 'Refresh failed. Check your connection and retry.');
    }
    finally { setRefreshing(false); }
  }

  async function retryListings() {
    setListingError('');
    setLoadingItems(true);
    try { await refreshListings(); }
    catch (error) { setListingError(error.message || 'Could not load listings. Check your connection and retry.'); }
    finally { setLoadingItems(false); }
  }

  function ListingCard({ item }) {
    const isSaved = favorites.includes(item.id);
    const inBasket = cart.some((entry) => entry.id === item.id);
    return <View style={styles.productCard}>
      <View style={styles.productImageWrap}>
        {item.image ? <Image source={{ uri: item.image }} style={styles.productImage} /> : <View style={styles.imageFallback}><Text style={styles.imageFallbackText}>A good find</Text></View>}
        <Pressable style={[styles.heartButton, isSaved && styles.heartButtonActive]} onPress={() => toggleSaved(item.id)} accessibilityLabel={isSaved ? 'Remove saved find' : 'Save find'}><Text style={[styles.heartText, isSaved && styles.heartTextActive]}>{isSaved ? '♥' : '♡'}</Text></Pressable>
        <Text style={styles.conditionTag}>{item.condition}</Text>
      </View>
      <Text style={styles.productCategory}>{item.category}</Text>
      <Text numberOfLines={2} style={styles.productTitle}>{item.title}</Text>
      <View style={styles.productMeta}><Text style={styles.productPrice}>{money.format(item.price)}</Text><Text numberOfLines={1} style={styles.productLocation}>{item.location}</Text></View>
      <Pressable disabled={busy} style={[styles.addButton, inBasket && styles.addButtonQuiet]} onPress={() => addToBasket(item)}><Text style={[styles.addButtonText, inBasket && styles.addButtonQuietText]}>{inBasket ? 'In your basket' : 'Add to basket'}</Text></Pressable>
    </View>;
  }

  function ListingList({ data, emptyTitle, emptyText }) {
    return data.length ? <View style={styles.listingGrid}>{data.map((item) => <ListingCard key={item.id} item={item} />)}</View> : <View style={styles.emptyCard}><Text style={styles.emptyMark}>✳</Text><Text style={styles.emptyTitle}>{emptyTitle}</Text><Text style={styles.emptyText}>{emptyText}</Text></View>;
  }

  function renderScreen() {
    if (screen === 'Discover') return <>
      <View style={styles.intro}><Text style={styles.eyebrow}>A marketplace with a little more meaning</Text><Text style={styles.heroTitle}>Good things,{ '\n' }passed on.</Text><Text style={styles.heroSub}>Find the pieces that feel like they were waiting for you.</Text></View>
      <View style={styles.searchBox}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="Find something lovely" placeholderTextColor="#94998f" style={styles.searchInput} returnKeyType="search" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>{categories.map((name) => <Pressable key={name} onPress={() => setCategory(name)} style={[styles.categoryChip, category === name && styles.categoryChipActive]}><Text style={[styles.categoryText, category === name && styles.categoryTextActive]}>{name}</Text></Pressable>)}</ScrollView>
      <View style={styles.sectionHeading}><View><Text style={styles.sectionEyebrow}>A few things worth finding</Text><Text style={styles.sectionTitle}>The good finds.</Text></View><Text style={styles.resultCount}>{visibleItems.length} finds</Text></View>
      {loadingItems ? <ActivityIndicator color={green} style={styles.loader} /> : listingError ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Couldn’t load the finds.</Text><Text style={styles.emptyText}>{listingError}</Text><Pressable style={styles.textButton} onPress={retryListings}><Text style={styles.textButtonText}>Try again →</Text></Pressable></View> : <ListingList data={visibleItems} emptyTitle="No live listings just yet." emptyText="When neighbours share their finds, you’ll see them here." />}
    </>;

    if (screen === 'Basket') return <>
      <View style={styles.pageIntro}><Text style={styles.eyebrow}>Your basket</Text><Text style={styles.pageTitle}>A few good finds.</Text><Text style={styles.pageSub}>Review your finds and connect with their sellers.</Text></View>
      {loadingAccount ? <View style={styles.emptyCard}><ActivityIndicator color={green} /><Text style={styles.emptyText}>Syncing your account basket…</Text></View> : cart.length ? <>
        {cart.map((item) => <View key={item.id} style={styles.basketRow}>{item.image ? <Image source={{ uri: item.image }} style={styles.basketImage} /> : <View style={styles.basketImageFallback}><Text style={styles.imageFallbackText}>✳</Text></View>}<View style={styles.basketInfo}><Text style={styles.productCategory}>{item.category}</Text><Text style={styles.basketTitle}>{item.title}</Text><Text style={styles.productLocation}>{item.location}</Text><Text style={styles.productPrice}>{money.format(item.price)}</Text></View><Pressable onPress={() => removeFromBasket(item.id)} style={styles.removeButton} accessibilityLabel={`Remove ${item.title}`}><Text style={styles.removeText}>×</Text></Pressable></View>)}
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Basket total</Text><Text style={styles.totalAmount}>{money.format(cart.reduce((sum, item) => sum + item.price, 0))}</Text></View>
        <View style={styles.noticeCard}><Text style={styles.noticeTitle}>No payment just yet.</Text><Text style={styles.noticeBody}>The Shop does not process payment or reserve listings. Sign in to send an inquiry and arrange payment and collection directly with each seller.</Text><Pressable disabled={busy} style={styles.primaryButton} onPress={sendInquiry}><Text style={styles.primaryButtonText}>{busy ? 'Contacting sellers…' : session?.user ? 'Continue with sellers' : 'Sign in to continue'}</Text></Pressable></View>
      </> : <View style={styles.emptyCard}><Text style={styles.emptyMark}>♡</Text><Text style={styles.emptyTitle}>Your basket is taking a little break.</Text><Text style={styles.emptyText}>Browse and add a live find to start your basket.</Text><Pressable style={styles.textButton} onPress={() => setScreen('Discover')}><Text style={styles.textButtonText}>Explore the marketplace →</Text></Pressable></View>}
    </>;

    if (screen === 'Saved') return <>
      <View style={styles.pageIntro}><Text style={styles.eyebrow}>Kept close</Text><Text style={styles.pageTitle}>Your saved finds.</Text><Text style={styles.pageSub}>Your favourites, synced to your account.</Text></View>
      {!session?.user ? <View style={styles.noticeCard}><Text style={styles.noticeTitle}>Keep your finds close.</Text><Text style={styles.noticeBody}>Sign in to save listings and see them on your other devices.</Text><Pressable style={styles.primaryButton} onPress={() => { setReturnScreen('Saved'); setScreen('Account'); }}><Text style={styles.primaryButtonText}>Sign in with Google</Text></Pressable></View> : loadingAccount ? <ActivityIndicator color={green} style={styles.loader} /> : <ListingList data={savedItems} emptyTitle="No saved finds yet." emptyText="Tap the heart on a live listing to keep it here." />}
    </>;

    return <>
      <View style={styles.pageIntro}><Text style={styles.eyebrow}>Your little corner of The Shop</Text><Text style={styles.pageTitle}>{session?.user ? `Welcome back, ${(session.user.user_metadata?.full_name || 'friend').split(' ')[0]}.` : 'Come on in.'}</Text><Text style={styles.pageSub}>{session?.user ? 'Your account and finds travel with you.' : 'Sign in to save finds and contact sellers.'}</Text></View>
      {supabaseConfigIssue ? <View style={styles.configCard}><Text style={styles.noticeTitle}>Set up mobile sign-in</Text><Text style={styles.noticeBody}>{supabaseConfigIssue}</Text></View> : null}
      {session?.user ? <>
        <View style={styles.profileCard}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(session.user.user_metadata?.full_name || session.user.email || 'U').slice(0, 1).toUpperCase()}</Text></View><View style={styles.profileInfo}><Text style={styles.profileName}>{session.user.user_metadata?.full_name || 'Shopper'}</Text><Text style={styles.profileEmail}>{session.user.email}</Text></View></View>
        <View style={styles.accountStats}><View style={styles.statBox}><Text style={styles.statNumber}>{cart.length}</Text><Text style={styles.statLabel}>In basket</Text></View><View style={styles.statBox}><Text style={styles.statNumber}>{favorites.length}</Text><Text style={styles.statLabel}>Saved finds</Text></View></View>
        <Pressable style={[styles.outlineButton, busy && styles.disabled]} onPress={signOut}><Text style={styles.outlineButtonText}>Sign out</Text></Pressable>
      </> : <View style={styles.noticeCard}><Text style={styles.noticeTitle}>Good to have you here.</Text><Text style={styles.noticeBody}>Use Google to sign in or create your account. Your email, basket, and saved finds stay linked to your Supabase account.</Text><Pressable disabled={busy || !!supabaseConfigIssue} style={[styles.primaryButton, (busy || !!supabaseConfigIssue) && styles.disabled]} onPress={signInWithGoogle}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Continue with Google</Text>}</Pressable><Text style={styles.smallNote}>Google confirms your email as part of sign-in.</Text></View>}
      <View style={styles.accountHelp}><Text style={styles.accountHelpTitle}>Your basket, wherever you are</Text><Text style={styles.accountHelpBody}>Guest items stay on this device. Sign in to merge them into your account and sync with the website.</Text></View>
    </>;
  }

  return <SafeAreaProvider><SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}><ExpoStatusBar style="dark" />
    <View style={styles.appHeader}><Pressable style={styles.brand} onPress={() => setScreen('Discover')}><View style={styles.brandMark}><Text style={styles.brandMarkText}>▧</Text></View><Text style={styles.brandText}>the shop<Text style={styles.brandDot}>.</Text></Text></Pressable><Pressable style={styles.headerBasket} onPress={() => setScreen('Basket')}><Text style={styles.headerBasketIcon}>▱</Text>{cart.length > 0 && <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{cart.length}</Text></View>}</Pressable></View>
    {notice ? <Pressable onPress={() => setNotice('')} style={styles.noticeToast}><Text style={styles.noticeToastText}>{notice}</Text><Text style={styles.toastClose}>×</Text></Pressable> : null}
    <View style={styles.content}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={green} />}>
        {renderScreen()}
      </ScrollView>
    </View>
    <View style={styles.tabBar}>
      <Tab title="Discover" icon="⌕" active={screen === 'Discover'} onPress={() => setScreen('Discover')} />
      <Tab title="Basket" icon="▱" active={screen === 'Basket'} badge={cart.length} onPress={() => setScreen('Basket')} />
      <Tab title="Saved" icon="♡" active={screen === 'Saved'} badge={favorites.length} onPress={() => setScreen('Saved')} />
      <Tab title="Account" icon="◉" active={screen === 'Account'} onPress={() => setScreen('Account')} />
    </View>
  </SafeAreaView></SafeAreaProvider>;
}

export default function App() { return <ShopApp />; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8f8f5' }, content: { flex: 1 }, scrollContent: { paddingHorizontal: 20, paddingBottom: 34 },
  appHeader: { height: 59, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8e8e1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8f8f5' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 }, brandMark: { width: 31, height: 31, borderRadius: 10, backgroundColor: green, alignItems: 'center', justifyContent: 'center' }, brandMarkText: { color: '#fffdf7', fontSize: 17 }, brandText: { color: '#272b26', fontSize: 19, fontWeight: '800', letterSpacing: -1 }, brandDot: { color: '#849565' }, headerBasket: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerBasketIcon: { color: green, fontSize: 27 }, headerBadge: { position: 'absolute', top: 3, right: 0, minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e9db' }, headerBadgeText: { color: green, fontSize: 9, fontWeight: '700' },
  noticeToast: { marginHorizontal: 14, marginTop: 10, paddingVertical: 11, paddingHorizontal: 13, backgroundColor: '#344a39', borderRadius: 5, flexDirection: 'row', gap: 8, alignItems: 'center' }, noticeToastText: { color: '#fffdf7', fontSize: 11, lineHeight: 16, flex: 1 }, toastClose: { color: '#fffdf7', fontSize: 20 },
  intro: { paddingTop: 28, paddingBottom: 20 }, eyebrow: { color: '#78836b', textTransform: 'uppercase', fontSize: 9, fontWeight: '700', letterSpacing: 1.3 }, heroTitle: { color: '#272b26', fontSize: 39, lineHeight: 42, letterSpacing: -2.5, fontWeight: '600', marginTop: 13 }, heroSub: { color: '#74796f', fontSize: 12, lineHeight: 19, marginTop: 9, maxWidth: 270 }, searchBox: { minHeight: 46, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e6e7df', backgroundColor: '#fffefa', borderRadius: 3, gap: 8 }, searchIcon: { color: '#718166', fontSize: 24, lineHeight: 27 }, searchInput: { flex: 1, color: '#272b26', fontSize: 12, paddingVertical: 10 }, categoryRail: { paddingTop: 14, paddingBottom: 9, gap: 7 }, categoryChip: { borderWidth: 1, borderColor: '#e3e4dc', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fffefa' }, categoryChipActive: { backgroundColor: green, borderColor: green }, categoryText: { color: '#686f63', fontSize: 9 }, categoryTextActive: { color: '#fffdf7', fontWeight: '700' }, sectionHeading: { marginTop: 21, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, sectionEyebrow: { color: '#78836b', textTransform: 'uppercase', fontSize: 8, letterSpacing: 1.2 }, sectionTitle: { color: '#272b26', fontSize: 24, fontWeight: '600', letterSpacing: -1.2, marginTop: 5 }, resultCount: { color: '#898d83', fontSize: 9, paddingBottom: 4 }, loader: { marginTop: 50 },
  listingGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }, productCard: { width: '48%', marginBottom: 10, backgroundColor: '#fffefa', padding: 9, borderWidth: 1, borderColor: '#ecece5' }, productImageWrap: { height: 158, position: 'relative', backgroundColor: '#e8e8e1' }, productImage: { width: '100%', height: '100%', resizeMode: 'cover' }, imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' }, imageFallbackText: { color: '#89917f', fontSize: 10 }, heartButton: { position: 'absolute', top: 8, right: 8, height: 29, width: 29, borderRadius: 16, backgroundColor: '#fffefa', alignItems: 'center', justifyContent: 'center' }, heartButtonActive: { backgroundColor: '#f1e6e2' }, heartText: { color: '#66735e', fontSize: 18, lineHeight: 21 }, heartTextActive: { color: '#9c5149' }, conditionTag: { position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 7, paddingVertical: 5, color: '#536249', backgroundColor: '#fffefaee', fontSize: 7, overflow: 'hidden' }, productCategory: { color: '#8b9086', fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10 }, productTitle: { minHeight: 34, color: '#30352e', fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 5 }, productMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginTop: 7 }, productPrice: { color: '#30352e', fontSize: 11, fontWeight: '700' }, productLocation: { color: '#898d83', fontSize: 7, flexShrink: 1, textAlign: 'right' }, addButton: { minHeight: 35, marginTop: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: green, borderRadius: 3 }, addButtonText: { color: '#fffdf7', fontSize: 9, fontWeight: '700' }, addButtonQuiet: { backgroundColor: '#eff1e9' }, addButtonQuietText: { color: '#52684f' },
  pageIntro: { paddingTop: 28, paddingBottom: 20 }, pageTitle: { color: '#272b26', fontSize: 31, lineHeight: 37, fontWeight: '600', letterSpacing: -1.7, marginTop: 10 }, pageSub: { color: '#83877e', fontSize: 11, lineHeight: 18, marginTop: 5 }, basketRow: { minHeight: 100, paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#e8e8e1', flexDirection: 'row', alignItems: 'center', gap: 12 }, basketImage: { width: 72, height: 72, backgroundColor: '#e8e8e1' }, basketImageFallback: { width: 72, height: 72, backgroundColor: '#e8e8e1', alignItems: 'center', justifyContent: 'center' }, basketInfo: { flex: 1 }, basketInfoProduct: { color: '#272b26' }, basketTitle: { color: '#30352e', fontSize: 12, fontWeight: '600', marginTop: 4 }, removeButton: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' }, removeText: { color: '#92968d', fontSize: 24 }, totalRow: { paddingVertical: 17, borderTopWidth: 1, borderTopColor: '#e8e8e1', flexDirection: 'row', justifyContent: 'space-between' }, totalLabel: { color: '#777d74', fontSize: 11 }, totalAmount: { color: '#272b26', fontSize: 16, fontWeight: '700' }, noticeCard: { marginTop: 17, padding: 18, backgroundColor: '#eff1e9', borderRadius: 4 }, noticeTitle: { color: '#30392f', fontSize: 16, fontWeight: '700', letterSpacing: -0.4 }, noticeBody: { color: '#73796e', fontSize: 10, lineHeight: 17, marginTop: 8 }, primaryButton: { minHeight: 45, alignItems: 'center', justifyContent: 'center', marginTop: 15, backgroundColor: green, borderRadius: 3, paddingHorizontal: 16 }, primaryButtonText: { color: '#fffdf7', fontSize: 11, fontWeight: '700' },
  emptyCard: { alignItems: 'center', paddingHorizontal: 25, paddingVertical: 40, borderWidth: 1, borderColor: '#e8e8e1', backgroundColor: '#fffefa' }, emptyMark: { color: '#7e8d70', fontSize: 28 }, emptyTitle: { color: '#33382f', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 12 }, emptyText: { color: '#858a80', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 }, textButton: { marginTop: 17, padding: 8 }, textButtonText: { color: green, fontWeight: '700', fontSize: 10 },
  configCard: { padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#e9dfc6', backgroundColor: '#faf5e9' }, profileCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderWidth: 1, borderColor: '#e8e8e1', backgroundColor: '#fffefa' }, profileAvatar: { width: 43, height: 43, borderRadius: 22, backgroundColor: '#e3e9dc', alignItems: 'center', justifyContent: 'center' }, profileAvatarText: { color: green, fontSize: 16, fontWeight: '700' }, profileInfo: { flex: 1 }, profileName: { color: '#30352e', fontSize: 13, fontWeight: '700' }, profileEmail: { color: '#858a80', fontSize: 9, marginTop: 4 }, accountStats: { flexDirection: 'row', gap: 10, marginTop: 12 }, statBox: { flex: 1, padding: 15, backgroundColor: '#fffefa', borderWidth: 1, borderColor: '#e8e8e1' }, statNumber: { color: green, fontSize: 19, fontWeight: '700' }, statLabel: { color: '#858a80', fontSize: 9, marginTop: 3 }, outlineButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dfe1d9', backgroundColor: '#fffefa', marginTop: 16, borderRadius: 3 }, outlineButtonText: { color: '#64735d', fontSize: 10, fontWeight: '700' }, disabled: { opacity: 0.55 }, smallNote: { color: '#858a80', fontSize: 8, textAlign: 'center', marginTop: 12 }, accountHelp: { marginTop: 22, paddingVertical: 17, borderTopWidth: 1, borderTopColor: '#e8e8e1' }, accountHelpTitle: { color: '#394137', fontSize: 12, fontWeight: '700' }, accountHelpBody: { color: '#858a80', fontSize: 10, lineHeight: 16, marginTop: 6 },
  tabBar: { minHeight: 61, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e3e4dc', backgroundColor: '#fffefa', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 5 }, tab: { minWidth: 60, alignItems: 'center', justifyContent: 'center', paddingVertical: 5, position: 'relative' }, tabIcon: { color: '#858a80', fontSize: 19, lineHeight: 22 }, tabText: { color: '#858a80', fontSize: 8, marginTop: 2 }, tabActive: { color: green, fontWeight: '700' }, tabBadge: { position: 'absolute', top: 1, right: 12, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, backgroundColor: '#e4eadf', alignItems: 'center', justifyContent: 'center' }, tabBadgeText: { color: green, fontSize: 7, fontWeight: '700' },
});
