import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requestPasswordReset, signIn, signUp, supabase } from "../lib/supabase";
import { forgetReferral, initialReferral, onReferralLink, rememberReferral } from "../lib/referral";
import { C } from "../theme";
import { Icon } from "../components/kit";

/**
 * Sign in and sign up, in the new RevoPass look.
 *
 * Still ONE screen with a mode switch (what was typed survives a wrong-link tap) and still the same
 * Supabase flow: signIn / signUp / requestPasswordReset in lib/supabase.ts. The reset link lands on
 * the web app, as before. Everything interactive is a native control; only the team photo is an
 * image (assets/auth-hero.png, cut from the supplied design).
 */
const LEGAL_BASE = process.env.EXPO_PUBLIC_APP_URL ?? "https://revopass.revospace.ng";
const GREEN = "#0F7A3B";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HERO = require("../assets/auth-hero.png");
/** The official RevoPass lockup (icon + wordmark, transparent background) as one image, so it can never drift apart or be re-typeset. */
const LOGO = require("../assets/logo-lockup.png");
const LOGO_RATIO = 936 / 276;
const HERO_RATIO = 708 / 900;

/** Layered green waves along the bottom edge, behind everything (light to deep green, as in the design). */
function FooterWaves({ width, height }: { width: number; height: number }) {
  const h = Math.min(Math.max(height * 0.13, 84), 140);
  const w = (y: number, c1: number, c2: number, y2: number) => `M0 ${h * y} C ${width * 0.28} ${h * c1}, ${width * 0.62} ${h * c2}, ${width} ${h * y2} L ${width} ${h} L 0 ${h} Z`;
  return (
    <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} style={s.curves} pointerEvents="none">
      <Defs>
        <LinearGradient id="wa" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#7ED67E" /><Stop offset="1" stopColor="#B4EAB0" /></LinearGradient>
        <LinearGradient id="wb" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#35B35A" /><Stop offset="1" stopColor="#5CC46E" /></LinearGradient>
        <LinearGradient id="wc" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#14A24A" /><Stop offset="1" stopColor="#0A6B31" /></LinearGradient>
      </Defs>
      <Path d={w(0.38, 0.0, 0.7, 0.08)} fill="url(#wa)" />
      <Path d={w(0.58, 0.28, 0.95, 0.3)} fill="url(#wb)" />
      <Path d={w(0.78, 0.55, 1.0, 0.62)} fill="url(#wc)" />
    </Svg>
  );
}

function Field({ icon, trailing, inputRef, error, ...input }: TextInputProps & {
  icon: string; trailing?: React.ReactNode; inputRef?: React.Ref<TextInput>; error?: boolean;
}) {
  return (
    <View style={[s.field, !!error && s.fieldError]}>
      <Icon name={icon} size={21} color="#111827" />
      <TextInput ref={inputRef} style={s.input} placeholderTextColor="#7B8794" {...input} />
      {trailing}
    </View>
  );
}

function EyeToggle({ shown, onToggle, label }: { shown: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={shown ? `Hide ${label}` : `Show ${label}`} style={s.eye}>
      <Icon name={shown ? "eye" : "eyeOff"} size={21} color="#111827" />
    </Pressable>
  );
}

function PrimaryButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !!disabled }}
      style={({ pressed }) => [s.button, (busy || disabled || pressed) && { opacity: 0.78 }]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 56">
        <Defs><LinearGradient id="g" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#1C9A47" /><Stop offset="1" stopColor="#0A6330" /></LinearGradient></Defs>
        <Rect width="100" height="56" fill="url(#g)" />
      </Svg>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export default function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [fullName, setFullName] = useState("");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referral, setReferral] = useState("");
  const [refState, setRefState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [agreed, setAgreed] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isUp = mode === "up";

  const refs = { business: useRef<TextInput>(null), email: useRef<TextInput>(null), phone: useRef<TextInput>(null), pw: useRef<TextInput>(null), pw2: useRef<TextInput>(null), ref: useRef<TextInput>(null) };

  // A referral link (or a code remembered from one) prefills the field and opens the sign-up form.
  useEffect(() => {
    let off = false;
    void initialReferral().then((c) => { if (c && !off) { setReferral(c); setMode("up"); } });
    const stop = onReferralLink((c) => { setReferral(c); setMode("up"); });
    return () => { off = true; stop(); };
  }, []);

  const checkReferral = async (code: string) => {
    const c = code.trim();
    if (!c) { setRefState("idle"); return; }
    setRefState("checking");
    try {
      const { data } = await supabase.rpc("validate_referral_code", { p_code: c });
      setRefState(data === true ? "ok" : "bad");
    } catch { setRefState("idle"); }   // an outage must not block sign-up; signUp() validates again
  };
  useEffect(() => { if (isUp && referral.trim()) void checkReferral(referral); }, [isUp]);   // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = () => { setMode(isUp ? "in" : "up"); setError(null); setNotice(null); };

  const submit = async () => {
    if (busy) return;
    setError(null); setNotice(null);
    if (!isUp) {
      if (!email.trim() || !password) { setError("Enter your email and password."); return; }
      setBusy(true);
      try { await signIn(email, password); onSignedIn(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(false); }
      return;
    }
    if (!fullName.trim()) { setError("Enter your full name."); return; }
    if (!business.trim()) { setError("Enter your business name."); return; }
    if (!EMAIL.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (phone.replace(/\D/g, "").length < 10) { setError("Enter a valid phone number, like 0803 123 4567."); return; }
    if (password.length < 6) { setError("Your password needs at least 6 characters."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    if (!agreed) { setError("Please agree to the Terms of Service and Privacy Policy to continue."); return; }
    setBusy(true);
    try {
      await signUp(email, password, fullName, referral, { businessName: business, phone });
      await forgetReferral();
      setNotice("Account created. If we sent you a confirmation email, open it before signing in.");
      setMode("in"); setPassword(""); setConfirm("");
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const forgot = async () => {
    setError(null); setNotice(null);
    if (!email.trim()) { setError("Enter your email address first, then tap Forgot password."); return; }
    setResetting(true);
    try {
      await requestPasswordReset(email);
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way. Open it on this phone, choose a new password, then come back and sign in.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setResetting(false); }
  };

  // Hero size follows the screen: as wide as the column allows, never taller than ~30% of the height.
  const colW = Math.min(width, 460) - 48;
  // Logo: about 60% of the column, capped for tablets and floored for the half-folded Z Flip; ratio is fixed by the asset.
  const logoW = Math.round(Math.min(Math.max(colW * 0.6, 170), 260));
  const heroW = useMemo(() => Math.max(Math.min(colW, (height * 0.3) / HERO_RATIO), 160), [colW, height]);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="dark" />
      <FooterWaves width={width} height={height} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 12) + Math.min(Math.max(height * 0.13, 84), 140) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.col}>
          <View style={s.brand} accessibilityRole="header">
            <Image source={LOGO} resizeMode="contain" style={{ width: logoW, height: logoW / LOGO_RATIO }} accessibilityLabel="RevoPass" />
          </View>

          {!isUp && <Image source={HERO} style={{ width: heroW, height: heroW * HERO_RATIO, alignSelf: "center", marginTop: 14 }} resizeMode="contain" accessibilityLabel="RevoPass team" />}

          <Text style={[s.title, isUp && { marginTop: 22 }]}>{isUp ? "Create Your Account" : "Welcome Back"}</Text>
          <Text style={s.sub}>{isUp ? "Start managing sales, inventory, customers and payments in one place." : "Sign in to continue managing your business."}</Text>

          {error && <View style={[s.banner, s.bannerError]} accessibilityLiveRegion="polite"><Text style={s.bannerText}>{error}</Text></View>}
          {notice && <View style={[s.banner, s.bannerOk]} accessibilityLiveRegion="polite"><Text style={s.bannerText}>{notice}</Text></View>}

          {isUp && (
            <>
              <Field icon="user" placeholder="Full Name" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" textContentType="name" editable={!busy} returnKeyType="next" onSubmitEditing={() => refs.business.current?.focus()} />
              <Field icon="store" inputRef={refs.business} placeholder="Business Name" value={business} onChangeText={setBusiness} autoCapitalize="words" editable={!busy} returnKeyType="next" onSubmitEditing={() => refs.email.current?.focus()} />
            </>
          )}

          <Field icon="mail" inputRef={refs.email} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" editable={!busy}
            returnKeyType="next" onSubmitEditing={() => (isUp ? refs.phone : refs.pw).current?.focus()} />

          {isUp && <Field icon="phone" inputRef={refs.phone} placeholder="Phone Number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" editable={!busy} returnKeyType="next" onSubmitEditing={() => refs.pw.current?.focus()} />}

          <Field icon="lock" inputRef={refs.pw} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false}
            autoComplete={isUp ? "new-password" : "current-password"} textContentType={isUp ? "newPassword" : "password"} editable={!busy}
            returnKeyType={isUp ? "next" : "go"} onSubmitEditing={() => (isUp ? refs.pw2.current?.focus() : void submit())}
            trailing={<EyeToggle shown={showPw} onToggle={() => setShowPw((v) => !v)} label="password" />} />

          {isUp && (
            <>
              <Field icon="lock" inputRef={refs.pw2} placeholder="Confirm Password" value={confirm} onChangeText={setConfirm} secureTextEntry={!showPw2} autoCapitalize="none" autoCorrect={false}
                autoComplete="new-password" textContentType="newPassword" editable={!busy} error={confirm.length > 0 && confirm !== password}
                returnKeyType="next" onSubmitEditing={() => refs.ref.current?.focus()}
                trailing={<EyeToggle shown={showPw2} onToggle={() => setShowPw2((v) => !v)} label="confirm password" />} />
              <Field icon="tag" inputRef={refs.ref} placeholder="Referral / Affiliate Code (Optional)" value={referral} onChangeText={(v) => { setReferral(v.toUpperCase()); setRefState("idle"); }} autoCapitalize="characters" autoCorrect={false} editable={!busy} error={refState === "bad"}
                onBlur={() => void checkReferral(referral)} onEndEditing={() => { if (referral.trim()) void rememberReferral(referral.trim()); }}
                trailing={refState === "checking" ? <ActivityIndicator size="small" color={C.text2} /> : refState === "ok" ? <Icon name="tick" size={20} color={GREEN} /> : null} />
              {refState === "ok" && <Text style={[s.hint, { color: GREEN }]}>Referral code applied.</Text>}
              {refState === "bad" && <Text style={[s.hint, { color: C.danger }]}>We couldn’t find that referral code. Fix it or clear the field to continue.</Text>}
            </>
          )}

          {!isUp && (
            <Pressable onPress={forgot} disabled={busy || resetting} hitSlop={8} style={s.forgot} accessibilityRole="button">
              <Text style={s.forgotText}>{resetting ? "Sending…" : "Forgot password?"}</Text>
            </Pressable>
          )}

          {isUp && (
            <View style={s.termsRow}>
              <Pressable onPress={() => setAgreed((v) => !v)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel="Agree to the Terms of Service and Privacy Policy" style={[s.box, agreed && s.boxOn]}>
                {agreed ? <Icon name="tick" size={17} color="#fff" strokeWidth={3} /> : null}
              </Pressable>
              <Text style={s.termsText}>
                I agree to the{" "}
                <Text style={s.link} onPress={() => void Linking.openURL(`${LEGAL_BASE}/terms`)} accessibilityRole="link">Terms of Service</Text>
                {" "}and{" "}
                <Text style={s.link} onPress={() => void Linking.openURL(`${LEGAL_BASE}/privacy`)} accessibilityRole="link">Privacy Policy</Text>.
              </Text>
            </View>
          )}

          <PrimaryButton label={isUp ? "Create Account" : "Sign In"} busy={busy} disabled={resetting} onPress={() => void submit()} />

          <Pressable onPress={switchMode} disabled={busy} style={s.switch} accessibilityRole="button">
            <Text style={s.switchText}>{isUp ? "Already have an account? " : "New to RevoPass? "}<Text style={s.link}>{isUp ? "Sign In" : "Create account"}</Text></Text>
          </Pressable>

                </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },
  curves: { position: "absolute", left: 0, right: 0, bottom: 0 },
  scroll: { flexGrow: 1, alignItems: "center" },
  col: { width: "100%", maxWidth: 460, paddingHorizontal: 24 },
  brand: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 29, fontWeight: "800", color: "#0B1520", textAlign: "center", marginTop: 12, letterSpacing: -0.5 },
  sub: { fontSize: 15.5, color: C.text2, textAlign: "center", marginTop: 6, marginBottom: 20, lineHeight: 22 },
  field: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#D5DDE3", borderRadius: 16, paddingHorizontal: 16, minHeight: 54, marginBottom: 12 },
  fieldError: { borderColor: C.danger },
  input: { flex: 1, fontSize: 16, color: "#0B1520", paddingVertical: 12 },
  eye: { padding: 2 },
  hint: { fontSize: 12.5, marginTop: -6, marginBottom: 10, marginLeft: 4 },
  forgot: { alignSelf: "flex-end", minHeight: 40, justifyContent: "center", marginBottom: 6 },
  forgotText: { color: GREEN, fontSize: 14.5, fontWeight: "700" },
  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginVertical: 8 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: "#B7C4BD", backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: GREEN, borderColor: GREEN },
  termsText: { flex: 1, fontSize: 14.5, color: "#243040", lineHeight: 21 },
  link: { color: GREEN, fontWeight: "700", textDecorationLine: "underline" },
  button: { minHeight: 56, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center", marginTop: 10 },
  buttonText: { color: "#fff", fontSize: 17.5, fontWeight: "700" },
  switch: { marginTop: 18, alignItems: "center", minHeight: 40, justifyContent: "center" },
  switchText: { color: "#243040", fontSize: 15 },
  banner: { borderRadius: 12, padding: 12, marginBottom: 14 },
  bannerError: { backgroundColor: "#FEE4E2" },
  bannerOk: { backgroundColor: "#E7F5EF" },
  bannerText: { fontSize: 13.5, color: C.text, lineHeight: 19 },
});
