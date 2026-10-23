import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

if (require.main === module) {
  app.listen(config.API_PORT, "0.0.0.0", () => {
    console.log(`tranergy-api listening on http://0.0.0.0:${config.API_PORT}`);
  });
}

export { app };
