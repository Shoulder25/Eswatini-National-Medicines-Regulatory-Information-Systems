const readline = require('node:readline');
const { stdin, stdout } = require('node:process');

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command from an interactive terminal'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(prompt);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    function finish(error) {
      stdin.setRawMode(false);
      stdin.removeListener('keypress', onKeypress);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }

    function onKeypress(character, key) {
      if (key && key.ctrl && key.name === 'c') {
        finish(new Error('Cancelled'));
      } else if (key && (key.name === 'return' || key.name === 'enter')) {
        finish();
      } else if (key && key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (character && key && !key.ctrl && !key.meta && value.length < 1024) {
        value += character;
      }
    }

    stdin.on('keypress', onKeypress);
  });
}

module.exports = { readHidden };
