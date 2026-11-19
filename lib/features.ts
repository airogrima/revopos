/**
 * Build-time switch for paying for a RevoPass subscription from inside the app.
 *
 * OFF by default. Apple (App Store Review 3.1.1) and Google (Play Payments
 * policy) require their own in-app billing for digital subscriptions sold in an
 * app, so a store build must not offer a Squad (card/bank) payment. Plans, prices
 * and module selection are still shown; only the pay/renew/downgrade controls and
 * the checkout call are hidden. Set EXPO_PUBLIC_ENABLE_WEB_CHECKOUT=1 only for
 * builds distributed outside the stores (the sideloaded preview APK). The server
 * never trusts this flag: activation always needs a verified Squad payment.
 */
export const CHECKOUT_ENABLED = process.env.EXPO_PUBLIC_ENABLE_WEB_CHECKOUT === "1";
