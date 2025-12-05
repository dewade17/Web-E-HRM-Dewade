// app/api/docs/spec/route.js
import { NextResponse } from 'next/server';
import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';

export async function GET() {
  try {
    // Root project
    const rootDir = process.cwd();

    // Scan semua file JS di app/api
    // Replace backslash -> slash biar aman di Windows
    const apiFiles = path.join(rootDir, 'app/api/**/*.js').replace(/\\/g, '/');

    const options = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'Dokumentasi API E-HRM',
          version: '1.0.0',
          description: 'Dokumentasi lengkap untuk API Mobile dan Admin E-HRM',
        },

        // ====== INI BAGIAN PENTING UNTUK AUTH ======
        components: {
          securitySchemes: {
            // Nama harus sama dengan yang dipakai di JSDoc: BearerAuth
            BearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT', // optional, cuma buat info
            },
          },
        },

        // Kalau mau semua endpoint default pakai Bearer:
        // security: [{ BearerAuth: [] }],
        //
        // Di kasus kamu, sudah ada banyak endpoint yang define
        // `security` langsung di JSDoc, jadi ini boleh dikosongin.
        security: [],

        servers: [
          {
            // Boleh kamu atur sesuai env
            url: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
            description: 'Default server',
          },
        ],
      },

      // Swagger akan baca semua komentar @swagger di file JS ini
      apis: [apiFiles],
    };

    const spec = swaggerJSDoc(options);
    return NextResponse.json(spec);
  } catch (error) {
    console.error('Swagger Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
