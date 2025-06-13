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

// ВРЕМЕННЫЙ маршрут для создания таблицы users
router.get('/init', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      )
    `);
    res.send('Таблица users создана!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при создании таблицы');
  }
});

router.get('/check-db', async (req, res) => {
  try {
    const result = await pool.query(`SELECT current_database()`);
    res.send(`Текущая база данных: ${result.rows[0].current_database}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при проверке базы данных');
  }
});
router.get('/raw-users', async (req, res) => {
  const result = await pool.query('SELECT id, name, password_hash FROM users');
  res.json(result.rows);
});


