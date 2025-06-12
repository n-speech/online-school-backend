import express from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, password_hash) VALUES ($1, $2)',
      [name, hash]
    );
    res.json({ message: 'Пользователь добавлен' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при добавлении' });
  }
});

router.post('/login', async (req, res) => {
  const { name, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE name = $1', [name]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Нет такого пользователя' });

  const valid = await bcrypt.compare(password, result.rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Неверный пароль' });

  res.json({ message: 'Вход выполнен' });
});

router.get('/users', async (req, res) => {
  const result = await pool.query('SELECT id, name FROM users ORDER BY id');
  res.json(result.rows);
});

export default router;
