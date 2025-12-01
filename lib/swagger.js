// lib/swagger.js
import { createSwaggerSpec } from 'next-swagger-doc';

export const getApiDocs = async () => {
  const spec = createSwaggerSpec({
    apiFolder: 'app/api', // Folder dimana route API berada
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Dokumentasi API E-HRM',
        version: '1.0.0',
        description: 'Dokumentasi lengkap untuk API Mobile dan Admin E-HRM',
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
      security: [],
    },
  });
  return spec;
};
