import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

if (require.main === module) {
  app.listen(config.API_PORT, () => {
    console.log(`tranergy-api listening on http://127.0.0.1:${config.API_PORT}`);
  });
}

export { app };
