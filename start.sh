#!/bin/bash

# Ctrl+C 또는 스크립트 종료 시 백엔드/프론트엔드 프로세스 정리
cleanup() {
    echo ""
    echo "🛑 서버를 종료하는 중입니다..."
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM EXIT

echo "=========================================="
echo " 🤟 수어지교 로컬 서버를 시작합니다"
echo "=========================================="

# Java 17 경로 설정 (Homebrew)
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"

# 1. 백엔드 실행 (백그라운드)
echo "▶️ [1/2] 백엔드 서버(Spring Boot :8080) 시작 중..."
(cd backend && ./gradlew bootRun) &

# 백엔드 기동 대기 (최대 30초)
echo "⏳ 백엔드 준비 대기 중..."
for i in {1..30}; do
    if curl -s http://localhost:8080/api/health | grep -q "ok"; then
        echo "✅ 백엔드 기동 완료 (http://localhost:8080)"
        break
    fi
    sleep 1
done

# 2. 프론트엔드 웹 실행
echo "▶️ [2/2] 프론트엔드 웹 앱(Expo :8081) 시작 중..."
(cd frontendcodes && npx expo start --web --port 8081 -c) &

echo ""
echo "=========================================="
echo " 🎉 모든 서버가 정상 실행되었습니다!"
echo " 👉 웹 브라우저 접속: http://localhost:8081"
echo " 👉 백엔드 API 서버: http://localhost:8080"
echo " 💡 종료하려면 이 터미널에서 Ctrl + C 를 누르세요. 사랑합니다."
echo "=========================================="

wait

