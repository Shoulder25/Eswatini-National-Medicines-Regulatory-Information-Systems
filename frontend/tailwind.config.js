/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#102f49',
        ocean: '#174d68',
        teal: '#0d8c83',
        mist: '#f1f6f7',
        gold: '#d9a64a',
      },
      boxShadow: {
        card: '0 24px 70px -32px rgba(16, 47, 73, 0.28)',
      },
    },
  },
  plugins: [],
};
