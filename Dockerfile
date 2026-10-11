# syntax=docker/dockerfile:1

# One image: the Angular front end is built, then served by the ASP.NET Core API from wwwroot.

FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx ng build --configuration production

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY global.json Directory.Build.props ./
COPY src/Folio.Core/Folio.Core.csproj src/Folio.Core/
COPY src/Folio.Api/Folio.Api.csproj src/Folio.Api/
RUN dotnet restore src/Folio.Api/Folio.Api.csproj
COPY src/ src/
RUN dotnet publish src/Folio.Api/Folio.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
# The PostgreSQL driver probes for Kerberos at start-up; without this library it logs a harmless error.
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /web/dist/folio-web/browser ./wwwroot
# Daily log files go here (bind-mounted by docker compose; ephemeral on a cloud host).
RUN mkdir -p /app/logs && chown $APP_UID /app/logs
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Folio.Api.dll"]
