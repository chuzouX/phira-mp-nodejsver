# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. Entry points are `src/index.ts` and `src/app.ts`; transport and server adapters are under `src/network/`, business logic under `src/domain/`, configuration in `src/config/`, logging in `src/logging/`, federation support in `src/federation/`, and plugin loading in `src/plugins/`. Tests are kept in `test/` as `*.test.ts`. Plugin packages and the official example live in `plugins/`, while `config/`, `data/`, and `docs/` contain runtime configuration, packaged assets, and documentation. TypeScript output is generated in `dist/`; packaged executables go to `outputs/`. Do not hand-edit generated output.

## Build, Test, and Development Commands

- `npm install` installs the locked dependency set.
- `npm run dev` starts the TypeScript server through Nodemon for local development.
- `npm run build` compiles the server and plugin TypeScript projects into `dist/`.
- `npm start` runs the compiled `dist/index.js`; build first.
- `npm test` runs the Jest suite verbosely; `npm run test:watch` reruns affected tests while editing.
- `npm run lint` checks all TypeScript files; `npm run lint:fix` applies safe fixes.
- `npm run format` formats files under `src/` with Prettier.
- `npm run plugin:create` scaffolds a plugin interactively.

## Coding Style & Naming Conventions

Use strict TypeScript and CommonJS-compatible imports. Prettier enforces two-space indentation, single quotes, semicolons, trailing commas, LF endings, and a 100-column width. ESLint adds the recommended TypeScript rules. Name classes and exported types in `PascalCase`, functions and variables in `camelCase`, and keep filenames consistent with their main export (for example, `RoomManager.ts`). Run lint and formatting before submitting changes.

## Testing Guidelines

Jest runs through `ts-jest` in the Node environment. Add focused tests to `test/<feature>.test.ts`; use Supertest for HTTP behavior where appropriate. Cover success, validation, failure, and persistence paths for changed behavior. There is no fixed coverage threshold, but new logic should be exercised. Run `npm test` and `npm run build` before opening a pull request.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style prefixes such as `feat:`, `fix:`, `docs:`, and `chore:`. Keep the subject imperative and scoped to one change. Pull requests should explain behavior and motivation, link relevant issues, list verification commands, and call out configuration or protocol compatibility changes. Include screenshots or sample API output when user-visible HTTP/dashboard behavior changes.

## Security & Configuration

Copy `.env.example` to `.env` for local setup. Never commit secrets, federation keys, tokens, logs, or runtime data. Document new environment variables in `.env.example` and the relevant file under `docs/`.
