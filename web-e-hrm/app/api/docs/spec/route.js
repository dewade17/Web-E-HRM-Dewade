import { NextResponse } from 'next/server';
import swaggerJSDoc from 'swagger-jsdoc';
import { join } from 'path'; // <--- 1. Import ini penting

export async function GET() {
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
    // 2. Ubah bagian 'apis' menjadi Absolute Path
    apis: [
      join(process.cwd(), 'app/api/**/*.js'), // Scan semua file JS di folder api
      join(process.cwd(), 'app/api/**/docs.js'), // Scan spesifik file docs.js (opsional, tapi bagus untuk memastikan)
    ],
  };

  try {
    const spec = swaggerJSDoc(options);
    return NextResponse.json(spec);
  } catch (error) {
    console.error('Swagger Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
