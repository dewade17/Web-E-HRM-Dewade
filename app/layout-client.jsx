"use client";

import { SessionProvider } from "next-auth/react";
import AuthWrapper from "./utils/auth/authWrapper";
import { AntdRegistry } from "@ant-design/nextjs-registry";



export default function LayoutClient({ children }) {
  return (
    <SessionProvider>
      <AuthWrapper>
        <AntdRegistry>{children}</AntdRegistry>
      </AuthWrapper>
    </SessionProvider>
  );
}
