import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { C } from "../theme";
import { u } from "./ui";

/**
 * Catches render errors so one bad screen does not take down the app.
 *
 * Without this, any exception thrown during render unmounts the whole tree —
 * on a release build that is a blank white screen with no explanation and no
 * way back, and the only recovery is force-quitting. A business owner mid-way
 * through checking what they are owed simply loses the app.
 *
 * Must be a class: there is no hook equivalent of componentDidCatch, and there
 * is unlikely to be one.
 *
 * Note this catches RENDER errors only. Errors thrown inside an async fetch are
 * caught by useOrgData and shown with a retry; those two paths together cover
 * the ways a screen actually fails.
 */

interface Props {
  children: ReactNode;
  /** Reset callback, so the host can also clear whatever caused the failure. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /*
     * Logged rather than swallowed. In development this shows in the Metro
     * console; in production it is the only trace that anything happened until
     * crash reporting is added, which is a separate decision.
     */
    console.error("[RevoPass] render error:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={[u.center, { backgroundColor: C.bg, flex: 1, padding: 24 }]}>
        <Text style={u.errorTitle}>Something went wrong</Text>
        <Text style={[u.errorBody, { marginBottom: 4 }]}>
          This screen could not be displayed. Your data is safe — nothing was
          changed.
        </Text>
        {/* The message, not the stack: it is occasionally the difference
            between a user reporting something useful and reporting "it broke". */}
        <Text style={[u.errorBody, { fontSize: 12, opacity: 0.7 }]}>
          {error.message}
        </Text>
        <Pressable
          onPress={this.reset}
          hitSlop={8}
          style={({ pressed }) => [u.retryButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={u.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
