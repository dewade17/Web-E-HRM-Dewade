import { NextResponse } from 'next/server';
import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';

export async function GET() {
  // 1. Ambil lokasi root project
  const rootDir = process.cwd();

  // 2. Buat path pencarian, tapi UBAH backslash (\) jadi slash (/) agar terbaca di Windows
  // Ini trik pentingnya!
  const apiFiles = path.join(rootDir, 'app/api/**/*.js').replace(/\\/g, '/');

  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'HRM API Documentation',
        version: '1.0.0',
        description: 'Dokumentasi API untuk sistem Web E-HRM',
      },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [
        {
          BearerAuth: [],
        },
      ],
    },
    // Gunakan variabel apiFiles yang sudah dinormalisasi
    apis: [apiFiles],
  };

  try {
    const spec = swaggerJSDoc(options);
    return NextResponse.json(spec);
  } catch (error) {
    console.error('Swagger Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
