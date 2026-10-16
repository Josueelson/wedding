/** Recompiler le CSS après modification des classes : npm run build:css */
module.exports = {
  content: { relative: true, files: ['./docs/**/*.html', './docs/js/**/*.js', './docs/admin/**/*.js'] },
  theme: { extend: {} },
  plugins: [],
};
