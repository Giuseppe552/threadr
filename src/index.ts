const seed = process.argv[2]

if (!seed) {
  console.log('usage: threadr <email>')
  process.exit(1)
}

console.log(`seed: ${seed}`)
