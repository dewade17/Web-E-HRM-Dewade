"use client";

import { Suspense, lazy } from "react";

const Dashboard = lazy(() => import("./dashboard"));

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}
