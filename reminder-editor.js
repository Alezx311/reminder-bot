const { loadReminders, saveReminders } = require('./storage')
const fs = require('fs')

// Показати нагадування у читабельному форматі
if (process.argv[2] === 'list') {
  const reminders = loadReminders()
  console.log('📋 Список нагадувань:')
  reminders.forEach(r => {
    console.log(`#${r.id}: ${r.text} | ${r.when} | Автор: ${r.author}`)
  })
}

// Експортувати у JSON
if (process.argv[2] === 'export') {
  const reminders = loadReminders()
  fs.writeFileSync('reminders.json', JSON.stringify(reminders, null, 2), 'utf8')
  console.log('✅ Експортовано у reminders.json — редагуй у VS Code')
}

// Імпортувати назад
if (process.argv[2] === 'import') {
  if (!fs.existsSync('reminders.json')) {
    console.error('❌ Немає reminders.json для імпорту')
    process.exit(1)
  }
  const reminders = JSON.parse(fs.readFileSync('reminders.json', 'utf8'))
  saveReminders(reminders)
  console.log('✅ Імпортовано з reminders.json у reminders.enc')
}
