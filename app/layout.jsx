import 'antd/dist/reset.css';
import './globals.css';
import { Poppins } from 'next/font/google';
import LayoutClient from './layout-client';
import { App } from 'antd';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata = {
  title: 'E-HRM',
  description: 'HR Management System',
};

export default function RootLayout({ children }) {
  return (
    <html lang='en'>
      <body className={poppins.variable}>
        <App>
          <LayoutClient>{children}</LayoutClient>
        </App>
      </body>
    </html>
  );
}
