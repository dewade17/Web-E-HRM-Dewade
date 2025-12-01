'use client';

import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

export default function ApiDoc() {
  // Jika sedang di production, tampilkan 404 atau pesan kosong agar tidak bisa diakses publik
  if (process.env.NODE_ENV === 'production') {
    return <div className='flex items-center justify-center h-screen'>404 - Page Not Found</div>;
  }

  return <SwaggerUI url='/api/docs/spec' />;
}
