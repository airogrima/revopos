import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Face ID / Touch ID / fingerprint unlock.
 *
 * WHAT THIS IS, PRECISELY
 *
 * It locks the app on this device. It is NOT a second factor and it does not
 * authenticate anyone to Supabase — the server never sees a fingerprint, and
 * there is no biometric credential to send it. What actually happens is that a
 * Supabase session is already persisted in the device keychain (see
 * lib/supabase.ts), which is what keeps someone signed in between launches, and
 * this asks the OS to confirm the device owner is present before that session
 * is used.
 *
 * That distinction matters for what it protects against: someone picking up an
 * unlocked phone and opening the books. It does nothing against an attacker who
 * has extracted the keychain, and claiming otherwise in the UI would be a lie
 * about how safe the data is.
 *
 * The check is delegated entirely to the OS. iOS and Android both return a
 * simple success/failure and never hand the app the biometric itself, which is
 * why nothing here stores or compares anything.
 */

const ENABLED_KEY = "revopass.biometric_lock";

export interface BiometricSupport {
  /** The device has the hardware AND the user has enrolled a face or finger. */
  available: boolean;
  /** "Face ID", "Touch ID", "fingerprint", "face unlock" — for the UI to name. */
  label: string;
  /** Hardware exists but nothing is enrolled: worth saying, since it is fixable. */
  hardwareOnly: boolean;
}

/**
 * What this device can actually do.
 *
 * Enrolment is checked separately from hardware because they fail differently:
 * a phone with no sensor can never offer this, while a phone with a sensor and
 * no registered fingerprint just needs the user to set one up in Settings. A
 * single "unavailable" would send the second person looking for a bug.
 */
export async function getBiometricSupport(): Promise<BiometricSupport> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    const { FACIAL_RECOGNITION, FINGERPRINT } = LocalAuthentication.AuthenticationType;
    const face = types.includes(FACIAL_RECOGNITION);
    const finger = types.includes(FINGERPRINT);

    /*
     * Apple's names are the ones on the device, so they are the ones to use —
     * "biometric authentication" on an iPhone reads like a different feature
     * from the Face ID prompt the user is about to be shown. Android varies by
     * manufacturer and has no equivalent brand, so it gets the plain words.
     */
    let label: string;
    if (Platform.OS === "ios") label = face ? "Face ID" : "Touch ID";
    else if (face && finger) label = "fingerprint or face unlock";
    else if (face) label = "face unlock";
    else label = "fingerprint";

    return { available: hasHardware && enrolled, label, hardwareOnly: hasHardware && !enrolled };
  } catch {
    // A device that cannot answer the question cannot offer the feature.
    return { available: false, label: "biometrics", hardwareOnly: false };
  }
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(ENABLED_KEY, "1");
  else await SecureStore.deleteItemAsync(ENABLED_KEY);
}

/**
 * Ask the OS to confirm the device owner.
 *
 * `disableDeviceFallback: false` leaves the passcode route in place on purpose.
 * A face that will not scan — wet hands, a mask, a bad angle — must not lock
 * someone out of their own invoices, and the passcode is the same standard the
 * phone itself is protected by.
 */
export async function authenticate(reason = "Unlock RevoPass"): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
