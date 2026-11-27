// ISP-Flow — build and deploy on the VPS with Docker Compose.
//
// One-time Jenkins setup:
//   1. Manage Jenkins > Credentials > add a "Secret file" with ID  isp-flow-env
//      (your filled-in copy of .env.docker.example).
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
        withCredentials([file(credentialsId: 'isp-flow-env', variable: 'ENV_FILE')]) {
          sh 'cp "$ENV_FILE" .env && chmod 600 .env'
        }
      }
    }

    stage('Build images') {
      steps {
        sh 'docker compose build --pull'
      }
    }

    stage('Deploy') {
      steps {
        // Recreates only the isp-flow containers whose image/config changed.
        // Volumes (database, uploads) are kept. Never use `down -v` here.
        sh 'docker compose up -d --remove-orphans'
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
