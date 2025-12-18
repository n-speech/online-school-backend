require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Pool } = require('pg');
const multer = require('multer');
const nodemailer = require('nodemailer');
const upload = multer({ dest: 'uploads/' });
const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log('✅ Подключено к базе данных PostgreSQL (Railway)'))
  .catch(err => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err);
    process.exit(1);
  });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'секрет_сессии',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false },
}));

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/cabinet');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 👤 Админка
app.get('/admin', requireLogin, (req, res) => {
  if (req.session.user.email !== 'info@native-speech.com') {
    return res.status(403).send('⛔ Доступ запрещён');
  }
  res.render('admin', { message: null });
});

app.post('/admin', requireLogin, async (req, res) => {
  if (req.session.user.email !== 'info@native-speech.com') {
    return res.status(403).send('⛔ Доступ запрещён');
  }

  const { name, user_email, lesson_id, grade, access, course_id, password } = req.body;

  try {
    const lessonId = lesson_id.toString();

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [user_email]);
    const existingUser = userResult.rows[0];

    // Создаём пользователя, если не существует
    if (!existingUser) {
      if (!password) {
        return res.render('admin', { message: '❗ Укажите пароль для нового пользователя' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO users (name, email, password) VALUES ($1, $2, $3)',
        [name, user_email, hashedPassword]
      );
    }

    // Добавляем курс пользователю (если указан и ещё не добавлен)
    if (course_id) {
      await pool.query(
        `INSERT INTO user_courses (user_email, course_id)
         VALUES ($1, $2)
         ON CONFLICT(user_email, course_id) DO NOTHING`,
        [user_email, course_id]
      );
    }

    // Добавляем/обновляем доступ к уроку
    const accessKey = `${course_id}/${lessonId}`;
    const accessNum = access === '1' ? 1 : 0;

    await pool.query(
      `INSERT INTO user_lessons (user_email, lesson_id, grade, access)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(user_email, lesson_id)
       DO UPDATE SET grade = EXCLUDED.grade, access = EXCLUDED.access`,
      [user_email, accessKey, grade, accessNum]
    );

    res.render('admin', { message: '✅ Данные успешно сохранены!' });
  } catch (error) {
    console.error('❌ Ошибка в POST /admin:', error.stack);
    res.render('admin', { message: 'Произошла ошибка при сохранении.' });
  }
});

// 🔐 Авторизация
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.render('login', { error: 'Пользователь не найден' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('login', { error: 'Неверный пароль' });

    // Получаем все курсы пользователя
    const coursesResult = await pool.query(
      'SELECT course_id FROM user_courses WHERE user_email = $1',
      [email]
    );
    const userCourses = coursesResult.rows.map(r => r.course_id);

    // Получаем доступные уроки
    const accessResult = await pool.query(
      'SELECT lesson_id FROM user_lessons WHERE user_email = $1 AND access = 1',
      [email]
    );
    const access = accessResult.rows.map(r => r.lesson_id.toString());

    req.session.user = {
      email: user.email,
      name: user.name || '',
      courses: userCourses, // массив ID курсов
      access, // пример: ["F1/lesson1", "F1/lesson2", "B1/lesson1"]
    };

    return res.redirect(user.email === 'info@native-speech.com' ? '/admin' : '/cabinet');
  } catch (error) {
    console.error('Ошибка при логине:', error);
    res.render('login', { error: 'Произошла ошибка' });
  }
});

// 🎓 Кабинет ученика (все курсы)
app.get('/cabinet', requireLogin, async (req, res) => {
  const user = req.session.user;
  
  try {
    // Получаем информацию по всем курсам пользователя
    const coursesData = [];

    for (const courseId of user.courses) {
      const courseResult = await pool.query('SELECT title FROM courses WHERE id = $1', [courseId]);
      const courseName = courseResult.rows[0] ? courseResult.rows[0].title : `Курс ${courseId}`;

      const lessonsResult = await pool.query(
        'SELECT * FROM lessons WHERE course_id = $1 ORDER BY number ASC',
        [courseId]
      );
      const lessons = lessonsResult.rows;

      const gradesResult = await pool.query(
        'SELECT lesson_id, grade FROM user_lessons WHERE user_email = $1',
        [user.email]
      );
      const gradeMap = {};
      gradesResult.rows.forEach(g => gradeMap[g.lesson_id] = g.grade);

      const availableLessons = lessons.map(lesson => {
        const key = `${courseId}/${lesson.id}`;
        return {
          ...lesson,
          access: user.access.includes(key),
          grade: gradeMap[key] || null,
        };
      });

      const total = availableLessons.length;
      const completed = availableLessons.filter(l => l.grade).length;
      const progress = total ? Math.round((completed / total) * 100) : 0;

      coursesData.push({
        id: courseId,
        name: courseName,
        lessons: availableLessons,
        progress,
        total,
        completed,
      });
    }

    res.render('cabinet', { user, coursesData });
  } catch (err) {
    console.error('❌ Ошибка загрузки данных кабинета:', err);
    res.send('❌ Ошибка загрузки данных');
  }
});

// 📖 Урок с курсом
app.get('/lesson/:course/:id', requireLogin, (req, res) => {
  const { course, id } = req.params;
  const user = req.session.user;
  const accessKey = `${course}/${id}`;

  if (!user.access.includes(accessKey)) {
    return res.status(403).send('⛔ Нет доступа к этому уроку');
  }

  const lessonPath = path.join(__dirname, 'courses', course, id, 'index.html');
  if (fs.existsSync(lessonPath)) {
    res.sendFile(lessonPath);
  } else {
    res.status(404).send('⛔ Файл урока не найден');
  }
});

// 🌐 СТАРЫЙ маршрут → редирект (опционально)
app.get('/lesson/:id', requireLogin, (req, res) => {
  const lessonId = req.params.id;
  const user = req.session.user;
  const course = user.courses[0] || 'F1'; // берём первый курс или дефолт

  return res.redirect(`/lesson/${course}/${lessonId}`);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// 🔒 Защищённые файлы
app.get('/protected-file/:course/:lesson/*', requireLogin, (req, res) => {
  const { course, lesson } = req.params;
  const fileRelativePath = req.params[0];
  
  const filePath = path.join(__dirname, 'courses', course, lesson, fileRelativePath);
  
  console.log('Запрошен файл:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    console.log('Файл не найден:', filePath);
    res.status(404).send('❌ Файл не найден');
  }
});

app.listen(port, () => {
  console.log(`✅ Сервер запущен: http://localhost:${port}`);
});
