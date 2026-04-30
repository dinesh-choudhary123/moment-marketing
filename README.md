# Moment Marketing

This is a [Next.js](https://nextjs.org) application bootstrapped with React 19, Tailwind CSS 4, and tRPC.

## 🚀 Getting Started

### Prerequisites
- Node.js (v20 or higher recommended)
- npm, yarn, pnpm, or bun

### Local Development

1. Install the dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 🛠 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Data Fetching & API**: [tRPC](https://trpc.io/) & [React Query](https://tanstack.com/query/latest)
- **Utilities**: Lucide React, Zod, clsx, tailwind-merge, date-fns

## 📦 Deployment Guide

This project is configured and optimized for production. It is ready to be deployed on modern cloud platforms, including our primary targets: **Base44** and **Threezinc**.

### Build for Production

Before deploying, ensure you generate an optimized production build:

```bash
npm run build
```

This command creates a `.next` folder with all the optimized static and server-rendered assets.

### Deploying to Base44

To deploy the Moment Marketing app to **Base44**:

1. Ensure the Base44 CLI or your CI/CD pipeline is configured with the necessary environment variables required for production.
2. The Base44 platform runs Node.js applications natively. Set the project's start command to:
   ```bash
   npm run start
   ```
3. Run the standard Base44 deployment sequence (e.g., `base44 deploy`). The platform will securely host the application and map it to the defined production domain.

### Deploying to Threezinc

To deploy the application to **Threezinc**:

1. Ensure your Threezinc environment is prepared for a Node.js or Docker-based runtime.
2. If deploying via container orchestration on Threezinc, you can utilize a standard Next.js `Dockerfile`:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build
   EXPOSE 3000
   CMD ["npm", "start"]
   ```
3. Push your image to the Threezinc container registry.
4. Execute the Threezinc deployment command to rollout the new release across your clusters.

For advanced environment configuration, secrets management, or scaling adjustments, please refer to the senior engineering team's internal documentation for Base44 and Threezinc.
