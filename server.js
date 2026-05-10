const { createApp } = require("./src/app");
const { PORT } = require("./src/env");

const app = createApp();

app.listen(PORT, () => {
  console.log(`Colossal Claw Adventure listening on ${PORT}`);
});
