// ISP-Flow — build and deploy on the VPS with Docker Compose.
//
// One-time Jenkins setup:
//   1. On the VPS, put your filled-in copy of .env.docker.example at /opt/isp-flow/.env
//      and let Jenkins read it:
//        sudo chown root:jenkins /opt/isp-flow/.env && sudo chmod 640 /opt/isp-flow/.env
//   2. The Jenkins agent must run on the VPS and be able to use `docker compose`
//      (e.g. the jenkins user is in the "docker" group).
//
// Everything is scoped to the compose project "isp-flow", so other apps on the
// server are never stopped, rebuilt or pruned.

pipeline {
  agent any

  options {
    disableConcurrentBuilds()          // never run two deploys at once
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    ENV_FILE = '/opt/isp-flow/.env'    // production secrets, kept on the VPS (not in git)
    COMPOSE_PROJECT_NAME = 'isp-flow'
    WEB_PORT = '2000'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Prepare .env') {
      steps {
        sh '''
          if [ ! -r "$ENV_FILE" ]; then
            echo "ERROR: $ENV_FILE is missing or not readable by user $(whoami)."
            echo "Create it from .env.docker.example and run:"
            echo "  sudo chown root:jenkins $ENV_FILE && sudo chmod 640 $ENV_FILE"
            exit 1
          fi
          # Copy, stripping Windows line endings (\\r) and a UTF-8 BOM if the file was edited on Windows
          sed -e 's/\\r$//' -e '1s/^\\xEF\\xBB\\xBF//' "$ENV_FILE" > .env
          chmod 600 .env

          # Check required keys exist with a value (prints names only, never secrets)
          missing=""
          for key in POSTGRES_PASSWORD JWT_SECRET PLATFORM_OWNER_EMAIL PLATFORM_OWNER_PASSWORD; do
            grep -Eq "^[[:space:]]*${key}=.+" .env || missing="$missing $key"
          done
          if [ -n "$missing" ]; then
            echo "ERROR: $ENV_FILE is missing a value for:$missing"
            echo "Keys found in the file:"
            grep -Eo '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' .env | tr -d ' =' || echo "  (none - file is empty or not KEY=value lines)"
            exit 1
          fi
          echo ".env OK"
        '''
      }
    }

    stage('Build images') {
      steps {
        sh 'docker compose --env-file .env build --pull'
      }
    }

    stage('Deploy') {
      steps {
        // Recreates only the isp-flow containers whose image/config changed.
        // Volumes (database, uploads) are kept. Never use `down -v` here.
        sh 'docker compose --env-file .env up -d --remove-orphans'
      }
    }

    stage('Health check') {
      steps {
        sh '''
          for i in $(seq 1 30); do
            if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/v1/health" >/dev/null; then
              echo "ISP-Flow is healthy"; exit 0
            fi
            sleep 5
          done
          echo "Health check failed"; docker compose ps; docker compose logs --tail=100 api web
          exit 1
        '''
      }
    }
  }

  post {
    always {
      sh 'rm -f .env'                  // secrets don't stay in the workspace
    }
    success {
      // Remove only old, untagged ISP-Flow images (left behind by rebuilds).
      sh 'docker image prune -f --filter "label=com.docker.compose.project=isp-flow" || true'
    }
  }
}
