const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
require('@dotenvx/dotenvx').config()

const algorithm = 'aes-256-cbc'
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'utf8')
const iv = Buffer.alloc(16, 0)
const filePath = path.join(__dirname, 'reminders.enc')
const logFilePath = path.join(__dirname, 'debug.log')

function logDebug(msg) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  console.debug(line.trim())

  try {
    fs.appendFileSync(logFilePath, line)
  } catch (error) {
    console.error('Помилка запису в лог файл:', error.message)
  }
}

function saveReminders(data) {
  try {
    logDebug(`Початок збереження ${data.length} нагадувань`)

    // Фільтруємо та очищуємо дані
    const cleanData = data
      .filter(r => {
        // Залишаємо повторювані нагадування або одноразові, що ще не настали
        if (r.cron) {
          return true // повторювані завжди залишаємо
        }
        if (r.when) {
          const reminderDate = new Date(r.when)
          return reminderDate > new Date()
        }
        return false
      })
      .map(({ job, ...rest }) => {
        // Видаляємо job властивість, яка не серіалізується
        return rest
      })

    logDebug(`Після фільтрації залишилось ${cleanData.length} нагадувань`)

    if (cleanData.length === 0) {
      logDebug('Немає нагадувань для збереження, видаляємо файл якщо існує')
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return
    }

    const json = JSON.stringify(cleanData, null, 2)
    logDebug(`Дані для збереження (${json.length} символів)`)

    // Перевіряємо довжину ключа шифрування
    if (key.length !== 32) {
      throw new Error(`Невірна довжина ключа шифрування: ${key.length}, очікується 32`)
    }

    const cipher = crypto.createCipheriv(algorithm, key, iv)
    const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])

    // Створюємо резервну копію перед збереженням
    if (fs.existsSync(filePath)) {
      const backupPath = `${filePath}.backup`
      fs.copyFileSync(filePath, backupPath)
      logDebug(`Створено резервну копію: ${backupPath}`)
    }

    fs.writeFileSync(filePath, encrypted)
    logDebug(`Нагадування успішно збережено у ${filePath} (${encrypted.length} байт)`)
  } catch (error) {
    logDebug(`Помилка збереження нагадувань: ${error.message}`)
    console.error('Помилка збереження нагадувань:', error)

    // Спробуємо відновити з резервної копії
    const backupPath = `${filePath}.backup`
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, filePath)
        logDebug(`Відновлено з резервної копії: ${backupPath}`)
      } catch (restoreError) {
        logDebug(`Помилка відновлення з резервної копії: ${restoreError.message}`)
      }
    }
  }
}

function loadReminders() {
  try {
    if (!fs.existsSync(filePath)) {
      logDebug(`Файл ${filePath} не знайдено, повертаємо порожній масив`)
      return []
    }

    logDebug(`Завантаження нагадувань з ${filePath}`)
    const encrypted = fs.readFileSync(filePath)

    if (encrypted.length === 0) {
      logDebug('Файл нагадувань порожній')
      return []
    }

    // Перевіряємо довжину ключа шифрування
    if (key.length !== 32) {
      throw new Error(`Невірна довжина ключа шифрування: ${key.length}, очікується 32`)
    }

    const decipher = crypto.createDecipheriv(algorithm, key, iv)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    const jsonString = decrypted.toString('utf8')

    logDebug(`Розшифровано ${jsonString.length} символів`)

    const data = JSON.parse(jsonString)

    if (!Array.isArray(data)) {
      throw new Error('Дані нагадувань не є масивом')
    }

    // Валідація кожного нагадування
    const validReminders = data.filter(r => {
      if (!r.id || !r.chatId || !r.text || !r.author) {
        logDebug(`Пропущено нагадування з неповними даними: ${JSON.stringify(r)}`)
        return false
      }

      if (!r.cron && !r.when) {
        logDebug(`Пропущено нагадування без часу: ${r.id}`)
        return false
      }

      if (r.when) {
        const reminderDate = new Date(r.when)
        if (isNaN(reminderDate.getTime())) {
          logDebug(`Пропущено нагадування з невірною датою: ${r.id}`)
          return false
        }
      }

      return true
    })

    logDebug(`Завантажено ${validReminders.length} з ${data.length} нагадувань`)
    return validReminders
  } catch (error) {
    logDebug(`Помилка завантаження нагадувань: ${error.message}`)
    console.error('Помилка завантаження нагадувань:', error)

    // Спробуємо завантажити з резервної копії
    const backupPath = `${filePath}.backup`
    if (fs.existsSync(backupPath)) {
      try {
        logDebug('Спроба завантажити з резервної копії')
        const encrypted = fs.readFileSync(backupPath)
        const decipher = crypto.createDecipheriv(algorithm, key, iv)
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
        const data = JSON.parse(decrypted.toString('utf8'))
        logDebug(`Успішно завантажено з резервної копії: ${data.length} нагадувань`)
        return Array.isArray(data) ? data : []
      } catch (backupError) {
        logDebug(`Помилка завантаження з резервної копії: ${backupError.message}`)
      }
    }

    return []
  }
}

// Функція для очищення старих лог файлів
function cleanupLogs() {
  try {
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath)
      const fileSizeInMB = stats.size / (1024 * 1024)

      if (fileSizeInMB > 10) {
        // Якщо файл більше 10 МБ
        const oldLogPath = `${logFilePath}.old`
        fs.renameSync(logFilePath, oldLogPath)
        logDebug('Лог файл став занадто великим, створено новий')
      }
    }
  } catch (error) {
    console.error('Помилка очищення логів:', error)
  }
}

// Перевірка ключа шифрування при ініціалізації
function validateEncryptionKey() {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY не встановлений в змінних середовища')
  }

  if (Buffer.from(process.env.ENCRYPTION_KEY, 'utf8').length !== 32) {
    throw new Error('ENCRYPTION_KEY повинен бути довжиною 32 байти (256 біт)')
  }

  logDebug('Ключ шифрування валідний')
}

// Ініціалізація
try {
  validateEncryptionKey()
  cleanupLogs()
} catch (error) {
  console.error('Помилка ініціалізації storage:', error.message)
  process.exit(1)
}

module.exports = { saveReminders, loadReminders, logDebug }
