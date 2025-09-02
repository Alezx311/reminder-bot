const { Telegraf, Markup } = require('telegraf')
const chrono = require('chrono-node')
const schedule = require('node-schedule')
require('@dotenvx/dotenvx').config()

const { saveReminders, loadReminders, logDebug } = require('./storage')

const bot = new Telegraf(process.env.BOT_TOKEN_PROD)

// Завантажуємо нагадування з файлу
let reminders = loadReminders()
let reminderId = reminders.length > 0 ? Math.max(...reminders.map(r => r.id)) + 1 : 1

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

// Команда /start
bot.start(ctx => {
  ctx.reply(`👋 Привіт! Я бот для нагадувань.

📝 Щоб створити нагадування, напишіть:
"зроби нагадування [текст] [час]"

⏰ Приклади:
• "зроби нагадування купити молоко завтра о 10:00"
• "зроби нагадування зустріч через 2 години"
• "зроби нагадування прийняти ліки щодня о 8:00"
• "зроби нагадування на 15 число купити продукти о 12:00"
• "зроби нагадування кожного 25 числа о 10 ранку"
• "зроби нагадування кожен понеділок зустріч о 9:30"

🔄 Повторювані нагадування:
• Щодня: "щодня о 8:00"
• Щотижня: "кожен понеділок о 10:00"  
• Щомісяця: "на 15 число о 12:00", "кожного 1 числа о 9:00"

📋 Команди:
/list - переглянути активні нагадування
/cancel [номер] - скасувати нагадування`)
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

// Парсимо текстові повідомлення для створення нагадувань
bot.on('text', ctx => {
  const rxp = /зроби нагадування/gi
  const message = ctx.message.text.toLowerCase()

  // Пропускаємо команди та згадування
  if (message.startsWith('/') || message.includes('@')) return

  if (rxp.test(message)) {
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
          message,
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
          timeMatch = message.match(pattern)
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
            if (message.includes('вечора') && hour < 12) {
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
          const match = message.match(pattern)
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
            if (d.re.test(message)) {
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
        when = chrono.uk.parseDate(message)
        if (when && when <= new Date()) {
          return ctx.reply('❌ Неможна створити нагадування на минулий час')
        }
      }

      if (cron || when) {
        const taskText = ctx.message.text.replace(rxp, '').trim()
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
