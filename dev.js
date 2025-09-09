const { Telegraf, Markup } = require('telegraf')
const chrono = require('chrono-node')
const schedule = require('node-schedule')
require('@dotenvx/dotenvx').config()

const { saveReminders, loadReminders, logDebug } = require('./storage')

const bot = new Telegraf(process.env.BOT_TOKEN_PROD)

// Завантажуємо нагадування з файлу
let reminders = loadReminders()
let reminderId = reminders.length > 0 ? Math.max(...reminders.map(r => r.id)) + 1 : 1

// Об'єкт для збереження поточних діалогів створення нагадувань
const creationSessions = new Map()

// Відновлюємо задачі після рестарту
reminders.forEach(r => {
  try {
    if (r.cron) {
      // Повторюване нагадування
      r.job = schedule.scheduleJob(r.cron, () => {
        bot.telegram
          .sendMessage(r.chatId, `🔔 Повторюване нагадування: ${r.text}\n👤 Від: ${r.author}`)
          .catch(err => logDebug(`Помилка надсилання повторюваного нагадування #${r.id}: ${err.message}`))
      })
      logDebug(`Відновлено повторюване нагадування #${r.id} з cron: ${r.cron}`)
    } else if (r.when) {
      const reminderDate = new Date(r.when)
      if (reminderDate > new Date()) {
        // Одноразове нагадування, яке ще не настало
        r.job = schedule.scheduleJob(reminderDate, () => {
          bot.telegram
            .sendMessage(r.chatId, `🔔 Нагадування: ${r.text}\n👤 Від: ${r.author}`)
            .catch(err => logDebug(`Помилка надсилання нагадування #${r.id}: ${err.message}`))

          // Видаляємо виконане нагадування
          reminders = reminders.filter(x => x.id !== r.id)
          saveReminders(reminders)
        })
        logDebug(`Відновлено одноразове нагадування #${r.id} на ${reminderDate.toLocaleString()}`)
      } else {
        logDebug(`Нагадування #${r.id} вже прострочене, пропускаємо`)
      }
    }
  } catch (error) {
    logDebug(`Помилка відновлення нагадування #${r.id}: ${error.message}`)
  }
})

// Очищуємо прострочені одноразові нагадування
const activeReminders = reminders.filter(r => r.cron || (r.when && new Date(r.when) > new Date()))
if (activeReminders.length !== reminders.length) {
  reminders = activeReminders
  saveReminders(reminders)
  logDebug(`Очищено ${reminders.length - activeReminders.length} прострочених нагадувань`)
}

// Функція для перевірки валідності cron виразу
function isValidCron(cronExpression) {
  const cronParts = cronExpression.trim().split(/\s+/)

  if (cronParts.length !== 5) {
    return false
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronParts

  // Базова валідація кожної частини
  const isValidRange = (value, min, max) => {
    if (value === '*') return true
    if (/^\d+$/.test(value)) {
      const num = parseInt(value)
      return num >= min && num <= max
    }
    if (/^\d+\/\d+$/.test(value)) return true // step values
    if (/^\d+-\d+$/.test(value)) return true // ranges
    if (/^(\d+,)*\d+$/.test(value)) return true // lists
    return false
  }

  return (
    isValidRange(minute, 0, 59) &&
    isValidRange(hour, 0, 23) &&
    isValidRange(dayOfMonth, 1, 31) &&
    isValidRange(month, 1, 12) &&
    isValidRange(dayOfWeek, 0, 7)
  )
}

// Функція для пояснення cron виразу українською
function explainCron(cronExpression) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ')

  let description = '🕒 Розклад: '

  // День місяця
  if (dayOfMonth !== '*') {
    if (month !== '*') {
      const months = [
        '',
        'січня',
        'лютого',
        'березня',
        'квітня',
        'травня',
        'червня',
        'липня',
        'серпня',
        'вересня',
        'жовтня',
        'листопада',
        'грудня',
      ]
      description += `${dayOfMonth} ${months[parseInt(month)]} `
    } else {
      description += `щомісяця ${dayOfMonth} числа `
    }
  }
  // День тижня
  else if (dayOfWeek !== '*') {
    const days = ['неділі', 'понеділка', 'вівторка', 'середи', 'четверга', "п'ятниці", 'суботи']
    if (dayOfWeek === '7') dayOfWeek = '0' // Sunday can be 0 or 7
    description += `щотижня в ${days[parseInt(dayOfWeek)]} `
  }
  // Щодня
  else {
    description += 'щодня '
  }

  // Час
  const hourStr = hour.padStart(2, '0')
  const minuteStr = minute.padStart(2, '0')
  description += `о ${hourStr}:${minuteStr}`

  return description
}

// Функція для скасування поточного діалогу
function cancelCreationSession(chatId) {
  if (creationSessions.has(chatId)) {
    creationSessions.delete(chatId)
    return true
  }
  return false
}

// Команда /start
bot.start(ctx => {
  // Скасовуємо поточний діалог якщо є
  cancelCreationSession(ctx.chat.id)

  ctx.reply(`👋 Привіт! Я бот для нагадувань.

📝 Швидке створення нагадування:
"зроби нагадування [текст] [час]"

🛠 Поетапне створення з cron:
/create - створити нагадування покроково

⏰ Приклади швидкого створення:
• "зроби нагадування купити молоко завтра о 10:00"
• "зроби нагадування зустріч через 2 години"
• "зроби нагадування прийняти ліки щодня о 8:00"
• "зроби нагадування на 15 число купити продукти о 12:00"
• "зроби нагадування кожного 25 числа о 10 ранку"
• "зроби нагадування кожен понеділок зустріч о 9:30"

📋 Команди:
/list - переглянути активні нагадування
/cancel [номер] - скасувати нагадування
/create - поетапне створення нагадування
/stop - зупинити поточний діалог створення`)
})

// Команда /create для поетапного створення
bot.command('create', ctx => {
  const chatId = ctx.chat.id

  // Скасовуємо попередній діалог якщо є
  cancelCreationSession(chatId)

  // Створюємо новий діалог
  creationSessions.set(chatId, {
    step: 'text',
    data: {},
  })

  ctx.reply(`🆕 Створення нового нагадування

📝 Крок 1/2: Напишіть текст нагадування
Що саме нагадати?

💡 Наприклад: "Купити продукти", "Зустріч з лікарем", "Прийняти ліки"

❌ Для скасування використовуйте /stop`)
})

// Команда /stop для скасування поточного діалогу
bot.command('stop', ctx => {
  const chatId = ctx.chat.id

  if (cancelCreationSession(chatId)) {
    ctx.reply('❌ Створення нагадування скасовано')
  } else {
    ctx.reply('ℹ️ Немає активного діалогу створення нагадування')
  }
})

// Команда /list показує активні нагадування
bot.command('list', ctx => {
  const active = reminders
    .filter(r => r.chatId === ctx.chat.id)
    .filter(r => r.cron || (r.when && new Date(r.when) > new Date()))

  if (active.length === 0) {
    return ctx.reply('📭 Немає активних нагадувань')
  }

  ctx.reply(`📋 Активні нагадування (${active.length}):`)

  active.forEach(r => {
    let msgDate
    if (r.cron) {
      // Розшифровуємо cron для зрозумілого відображення
      const cronParts = r.cron.split(' ')
      const minute = cronParts[0]
      const hour = cronParts[1]
      const dayOfMonth = cronParts[2]
      const dayOfWeek = cronParts[4]

      if (dayOfMonth !== '*') {
        // Щомісячне нагадування
        msgDate = `Щомісяця ${dayOfMonth} числа о ${hour}:${minute.padStart(2, '0')}`
      } else if (dayOfWeek !== '*') {
        // Щотижневе нагадування
        const dayNames = ['неділю', 'понеділок', 'вівторок', 'середу', 'четвер', "п'ятницю", 'суботу']
        const dayName = dayNames[parseInt(dayOfWeek)]
        msgDate = `Щотижня в ${dayName} о ${hour}:${minute.padStart(2, '0')}`
      } else if (dayOfWeek === '*') {
        // Щоденне нагадування
        msgDate = `Щодня о ${hour}:${minute.padStart(2, '0')}`
      } else {
        msgDate = `Повторюване (${r.cron})`
      }
    } else {
      msgDate = new Date(r.when).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    ctx.reply(
      `#${r.id} 📌 ${r.text}\n🕒 ${msgDate}\n👤 Від: ${r.author}`,
      Markup.inlineKeyboard([Markup.button.callback(`❌ Скасувати #${r.id}`, `cancel_${r.id}`)]),
    )
  })
})

// Команда /cancel відміняє заплановане нагадування
bot.command('cancel', ctx => {
  const parts = ctx.message.text.split(' ')
  if (parts.length < 2) {
    return ctx.reply('❌ Вкажіть номер нагадування. Приклад: /cancel 123')
  }

  const id = parseInt(parts[1])
  if (isNaN(id)) {
    return ctx.reply('❌ Невірний номер нагадування')
  }

  const index = reminders.findIndex(r => r.id === id && r.chatId === ctx.chat.id)
  if (index === -1) {
    logDebug(`/cancel: Нагадування #${id} не знайдено для chatId=${ctx.chat.id}`)
    return ctx.reply('❌ Нагадування не знайдено або вже видалено')
  }

  try {
    if (reminders[index].job) {
      reminders[index].job.cancel()
      logDebug(`/cancel: Скасовано job для нагадування #${id}`)
    }
    reminders.splice(index, 1)
    saveReminders(reminders)
    ctx.reply(`✅ Нагадування #${id} скасовано`)
    logDebug(`/cancel: Видалено нагадування #${id} для chatId=${ctx.chat.id}`)
  } catch (error) {
    logDebug(`Помилка скасування нагадування #${id}: ${error.message}`)
    ctx.reply('❌ Помилка скасування нагадування')
  }
})

// Дія по натисканню кнопки
bot.on('callback_query', ctx => {
  const data = ctx.callbackQuery.data
  if (data.startsWith('cancel_')) {
    const id = parseInt(data.replace('cancel_', ''))
    const index = reminders.findIndex(r => r.id === id && r.chatId === ctx.chat.id)

    if (index !== -1) {
      try {
        if (reminders[index].job) {
          reminders[index].job.cancel()
        }
        reminders.splice(index, 1)
        saveReminders(reminders)
        ctx.editMessageText(`❌ Нагадування #${id} скасовано`)
        ctx.answerCbQuery('Нагадування скасовано')
        logDebug(`Callback: Видалено нагадування #${id}`)
      } catch (error) {
        logDebug(`Помилка callback скасування #${id}: ${error.message}`)
        ctx.answerCbQuery('Помилка скасування', { show_alert: true })
      }
    } else {
      ctx.answerCbQuery('Нагадування не знайдено або вже скасовано', { show_alert: true })
    }
  }
})

// Парсимо текстові повідомлення
bot.on('text', ctx => {
  const chatId = ctx.chat.id
  const message = ctx.message.text

  // Перевіряємо, чи є активний діалог створення
  if (creationSessions.has(chatId)) {
    const session = creationSessions.get(chatId)

    if (session.step === 'text') {
      // Зберігаємо текст нагадування
      session.data.text = message.trim()
      session.step = 'cron'

      ctx.reply(`✅ Текст нагадування збережено: "${session.data.text}"

⏰ Крок 2/2: Введіть cron вираз для розкладу
Формат: хвилини години день_місяця місяць день_тижня

📚 Приклади:
• "0 9 * * *" - щодня о 9:00
• "30 8 * * 1" - щопонеділка о 8:30
• "0 12 1 * *" - 1 числа кожного місяця о 12:00
• "0 18 * * 1-5" - по будням о 18:00
• "0 10 */3 * *" - кожні 3 дні о 10:00

💡 Використовуйте:
• * - будь-яке значення
• числа - конкретні значення  
• діапазони (1-5)
• списки (1,3,5)
• кроки (*/2)

❌ Для скасування використовуйте /stop`)

      creationSessions.set(chatId, session)
      return
    }

    if (session.step === 'cron') {
      const cronExpression = message.trim()

      // Перевіряємо валідність cron виразу
      if (!isValidCron(cronExpression)) {
        return ctx.reply(`❌ Невірний формат cron виразу!

📋 Правильний формат: хвилини години день_місяця місяць день_тижня
Приклад: "0 9 * * *" (щодня о 9:00)

🔢 Допустимі значення:
• Хвилини: 0-59
• Години: 0-23  
• День місяця: 1-31
• Місяць: 1-12
• День тижня: 0-7 (0 та 7 = неділя)

Спробуйте ще раз або використовуйте /stop для скасування`)
      }

      // Створюємо нагадування
      try {
        const author = ctx.from.username
          ? '@' + ctx.from.username
          : `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()

        // Створюємо job
        const job = schedule.scheduleJob(cronExpression, () => {
          bot.telegram
            .sendMessage(chatId, `🔔 Повторюване нагадування: ${session.data.text}\n👤 Від: ${author}`)
            .catch(err => logDebug(`Помилка надсилання повторюваного нагадування #${reminderId}: ${err.message}`))
        })

        // Створюємо запис нагадування
        const record = {
          id: reminderId,
          chatId,
          text: session.data.text,
          cron: cronExpression,
          author,
          job,
          repeat: true,
        }

        reminders.push(record)
        saveReminders(reminders)

        // Пояснюємо розклад
        const scheduleDescription = explainCron(cronExpression)

        ctx.reply(`✅ Нагадування #${reminderId} успішно створено!

📌 Текст: ${session.data.text}
${scheduleDescription}
🤖 Cron: ${cronExpression}
👤 Автор: ${author}

📋 Переглянути всі нагадування: /list`)

        logDebug(`Створено повторюване нагадування #${reminderId} з cron: ${cronExpression}`)

        // Завершуємо діалог
        creationSessions.delete(chatId)
        reminderId++
      } catch (error) {
        logDebug(`Помилка створення cron нагадування: ${error.message}`)
        ctx.reply(`❌ Помилка створення нагадування: ${error.message}

Спробуйте ще раз або використовуйте /stop для скасування`)
      }

      return
    }
  }

  // Стандартна обробка швидких нагадувань
  const rxp = /зроби нагадування/gi
  const messageText = message.toLowerCase()

  // Пропускаємо команди та згадування
  if (messageText.startsWith('/') || messageText.includes('@')) return

  if (rxp.test(messageText)) {
    try {
      let cron = null
      let when = null
      let dayOfWeek = null
      let dayOfMonth = null
      let hour = 12,
        minute = 0

      // Перевіряємо на повторювані нагадування
      const isRepeating =
        /кож(ен|ного|ну|ній|ий|а|е|і)|щодня|щопонеділ|щовівтор|щосеред|щочетвер|щоп'ятн|щосубот|щонеділ|число|місяця/.test(
          messageText,
        )

      if (isRepeating) {
        // Шукаємо час у різних форматах
        const timePatterns = [
          /\s[ов]\s?(\d{1,2})(?::(\d{2}))?\s*(?:год|годин)/i, // "о 10 годині"
          /\s[ов]\s?(\d{1,2})(?::(\d{2}))?/i, // "о 15:30"
          /\s[ов]\s?(\d{1,2}):(\d{2})/i, // "15:30"
          /\s[ов]\s?(\d{1,2})\s*год(?:ин[іуа])?/i, // "10 годині", "15 год"
          /\s[ов]\s?(\d{1,2})\s*(?:год(?:ин[іуа])?)??\s*ранку/i, // "10 ранку"
          /\s[ов]\s?(\d{1,2})\s*(?:год(?:ин[іуа])?)??\s*вечора/i, // "8 вечора"
          /\s[ов]\s?(\d{1,2})\s*(?:год(?:ин[іуа])?)??\s*дня/i, // "2 дня"
        ]

        let timeMatch = null
        for (const pattern of timePatterns) {
          timeMatch = messageText.match(pattern)
          if (timeMatch) break
        }

        if (timeMatch) {
          if (timeMatch[1]) {
            hour = parseInt(timeMatch[1])
            if (timeMatch[2]) {
              minute = parseInt(timeMatch[2])
            } else {
              minute = 0 // Якщо хвилини не вказано, ставимо 00
            }

            // Корекція часу для "вечора"
            if (messageText.includes('вечора') && hour < 12) {
              hour += 12
            }
          }

          // Перевірка валідності часу
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return ctx.reply('❌ Невірний формат часу. Використовуйте години 0-23 та хвилини 0-59')
          }
        }

        // Перевіряємо на нагадування по числу місяця
        const monthlyPatterns = [
          /на\s+(\d{1,2})\s+число/i,
          /(\d{1,2})\s+число\s+кож/i,
          /кожен\s+(\d{1,2})/i,
          /кожного\s+(\d{1,2})/i,
          /щом[іе]сяця\s+(\d{1,2})/i,
          /(\d{1,2})\s+числа/i,
          /кожного\s+(\d{1,2})\s+числа/i,
          /(\d{1,2})\s+числа\s+місяця/i,
          /(\d{1,2})\s+число\s+місяця/i,
          /(\d{1,2})\s+числа\s+кожного\s+місяця/i,
        ]

        for (const pattern of monthlyPatterns) {
          const match = messageText.match(pattern)
          if (match) {
            dayOfMonth = parseInt(match[1])
            if (dayOfMonth >= 1 && dayOfMonth <= 31) {
              break
            } else {
              return ctx.reply('❌ День місяця повинен бути від 1 до 31')
            }
          }
        }

        // Якщо знайдено день місяця, створюємо щомісячне нагадування
        if (dayOfMonth) {
          cron = `${minute} ${hour} ${dayOfMonth} * *`
          logDebug(`Створено cron для щомісячного нагадування: ${cron}`)
        } else {
          // Перевіряємо на щотижневі нагадування
          const days = [
            { re: /понеділ(ок|ка|ку|ком|ці)|щопонеділ/i, cron: '1' },
            { re: /вівтор(ок|ка|ку|ком|ці)|щовівтор/i, cron: '2' },
            { re: /серед(а|и|у|ою|і)|щосеред/i, cron: '3' },
            { re: /четвер(г|га|гу|гом|зі)|щочетвер/i, cron: '4' },
            { re: /п'ятниц(я|і|ю|ею|ями)|щоп'ятн/i, cron: '5' },
            { re: /субот(а|и|у|ою|і)|щосубот/i, cron: '6' },
            { re: /неділ(я|і|ю|ею|ями)|щонеділ/i, cron: '0' },
            { re: /щодня|кожен день|дня|день/i, cron: '*' },
          ]

          for (const d of days) {
            if (d.re.test(messageText)) {
              dayOfWeek = d.cron
              break
            }
          }

          if (dayOfWeek !== null) {
            cron = `${minute} ${hour} * * ${dayOfWeek}`
            logDebug(`Створено cron для щотижневого нагадування: ${cron}`)
          }
        }
      }

      // Якщо не повторюване, пробуємо парсити як разове
      if (!cron) {
        when = chrono.uk.parseDate(messageText)
        if (when && when <= new Date()) {
          return ctx.reply('❌ Неможна створити нагадування на минулий час')
        }
      }

      if (cron || when) {
        const taskText = message.replace(rxp, '').trim()
        if (!taskText) {
          return ctx.reply('❌ Опишіть, про що нагадати')
        }

        const chatId = ctx.chat.id
        const author = ctx.from.username
          ? '@' + ctx.from.username
          : `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()

        let job
        let record

        if (cron) {
          // Повторюване нагадування
          job = schedule.scheduleJob(cron, () => {
            bot.telegram
              .sendMessage(chatId, `🔔 Повторюване нагадування: ${taskText}\n👤 Від: ${author}`)
              .catch(err => logDebug(`Помилка надсилання повторюваного нагадування #${reminderId}: ${err.message}`))
          })

          record = {
            id: reminderId,
            chatId,
            text: taskText,
            cron,
            author,
            job,
            repeat: true,
          }

          reminders.push(record)
          saveReminders(reminders)
          // Створюємо зрозуміле пояснення розкладу
          let scheduleDescription = ''
          const cronParts = cron.split(' ')

          if (cronParts[2] !== '*') {
            // Щомісячне нагадування
            scheduleDescription = `щомісяця ${cronParts[2]} числа о ${hour.toString().padStart(2, '0')}:${minute
              .toString()
              .padStart(2, '0')}`
          } else if (cronParts[4] !== '*') {
            // Щотижневе нагадування
            const dayNames = ['неділю', 'понеділок', 'вівторок', 'середу', 'четвер', "п'ятницю", 'суботу']
            const dayName = dayNames[parseInt(cronParts[4])]
            scheduleDescription = `щотижня в ${dayName} о ${hour.toString().padStart(2, '0')}:${minute
              .toString()
              .padStart(2, '0')}`
          } else if (cronParts[4] === '*') {
            // Щоденне нагадування
            scheduleDescription = `щодня о ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
          }

          ctx.reply(`⏳ Повторюване нагадування #${reminderId} збережено\n📅 Розклад: ${scheduleDescription}`)
          logDebug(`Створено повторюване нагадування #${reminderId} з cron: ${cron} (${scheduleDescription})`)
        } else if (when) {
          // Одноразове нагадування
          const currentReminderId = reminderId // Зберігаємо ID для використання в callback

          job = schedule.scheduleJob(when, () => {
            bot.telegram
              .sendMessage(chatId, `🔔 Нагадування: ${taskText}\n👤 Від: ${author}`)
              .catch(err => logDebug(`Помилка надсилання нагадування #${currentReminderId}: ${err.message}`))

            // Видаляємо виконане нагадування
            reminders = reminders.filter(r => r.id !== currentReminderId)
            saveReminders(reminders)
            logDebug(`Виконано та видалено нагадування #${currentReminderId}`)
          })

          record = {
            id: reminderId,
            chatId,
            text: taskText,
            when: when.toISOString(),
            author,
            job,
            repeat: false,
          }

          reminders.push(record)
          saveReminders(reminders)
          ctx.reply(`⏳ Нагадування #${reminderId} збережено на ${when.toLocaleString('uk-UA')}`)
          logDebug(`Створено одноразове нагадування #${reminderId} на ${when.toISOString()}`)
        }

        reminderId++
      } else {
        ctx.reply(`❌ Не зрозумів час нагадування. Спробуйте:
• "зроби нагадування купити молоко завтра о 10:00"
• "зроби нагадування через годину"
• "зроби нагадування щодня о 8:00"
• "зроби нагадування на 15 число о 12:00"
• "зроби нагадування кожного 25 числа о 10 ранку"
• "зроби нагадування кожен понеділок о 9:30"`)
      }
    } catch (error) {
      logDebug(`Помилка створення нагадування: ${error.message}`)
      logDebug(`Повний стек помилки: ${error.stack}`)
      logDebug(`Повідомлення користувача: "${message}"`)
      ctx.reply('❌ Помилка створення нагадування. Деталі помилки записано в лог. Спробуйте ще раз.')
    }
  }
})

// Обробка помилок
bot.catch((err, ctx) => {
  logDebug(`Помилка бота: ${err.message}`)
  console.error('Помилка бота:', err)
})

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Отримано SIGINT. Graceful shutdown...')
  logDebug('Отримано SIGINT. Зупинка бота...')
  bot.stop('SIGINT')
})

process.once('SIGTERM', () => {
  console.log('Отримано SIGTERM. Graceful shutdown...')
  logDebug('Отримано SIGTERM. Зупинка бота...')
  bot.stop('SIGTERM')
})

bot
  .launch()
  .then(() => {
    logDebug('Бот запущено успішно!')
    console.log('🤖 Бот працює!')
  })
  .catch(err => {
    logDebug(`Помилка запуску бота: ${err.message}`)
    console.error('Помилка запуску бота:', err)
  })
