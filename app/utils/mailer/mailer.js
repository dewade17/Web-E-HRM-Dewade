import nodemailer from 'nodemailer';

const host = process.env.MAIL_HOST || 'smtp.gmail.com';
const port = Number(process.env.MAIL_PORT || 465);
const secure = port === 465;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
  },

  connectionTimeout: 20_000,
  socketTimeout: 20_000,
  greetingTimeout: 10_000,
  family: 4,
  tls: {
    servername: host,
  },
  // logger: true,  // aktifkan saat debug
  // debug: true,   // aktifkan saat debug
});

export default transporter;
