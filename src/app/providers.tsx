"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { ThirdwebProvider } from "thirdweb/react";

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThirdwebProvider>{children}</ThirdwebProvider>
    </GoogleOAuthProvider>
  );
}
