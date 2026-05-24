FROM node:lts-slim

ENV CRYPT_SECRET=ThisIsNotSoSecret
ENV TENANT_ID=docker

RUN npm i -g pnpm

RUN mkdir "/.local" && chmod -R 777 "/.local"
