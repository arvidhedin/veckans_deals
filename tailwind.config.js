// Tailwind config for Veckans Deals (public/index.html + public/app.js).
// public/tailwind.css is built from this by .github/workflows/build_css.yml on every push,
// or locally with:
//   npx tailwindcss@3.4.19 -c tailwind.config.js -i src/tailwind.css -o public/tailwind.css --minify
module.exports = {
  content: ['./public/index.html', './public/app.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        brand: {
          deal: '#E11D48',
        },
        store: {
          ica: '#E21936',
          willys: '#009345',
          hemkop: '#D31115',
          coop: '#007A33',
          lidl: '#00509E',
        },
      },
    },
  },
};
