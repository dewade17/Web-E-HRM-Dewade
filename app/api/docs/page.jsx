'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';

const SwaggerUI = process.env.NODE_ENV === 'production' ? () => null : dynamic(() => import('swagger-ui-react'), { ssr: false });

export default function ApiDoc() {
  // Jika sedang di production, tampilkan 404 atau pesan kosong agar tidak bisa diakses publik
  if (process.env.NODE_ENV === 'production') {
    return <div className='flex items-center justify-center h-screen'>404 - Page Not Found</div>;
  }

  useEffect(() => {
    import('swagger-ui-react/swagger-ui.css');
  }, []);

  const SwaggerComponent = useMemo(() => SwaggerUI, []);

  return <SwaggerComponent url='/api/docs/spec' />;
}
