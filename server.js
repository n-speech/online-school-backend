import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use('/auth', authRoutes);
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.get('/', (req, res) => {
  res.send('Backend работает!');
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
