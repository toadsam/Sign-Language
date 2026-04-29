import json
import os
import subprocess
import urllib.request


PROJECT_ID = "signhand-2641"
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/quiz_items"


QUIZ_ITEMS = [
    {"id": "q001", "category": "basic", "level": 1, "difficulty": "easy", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["가다", "가깝다", "막히다", "끊다"]},
    {"id": "q002", "category": "basic", "level": 1, "difficulty": "easy", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["눈", "하늘", "갈색", "체온"]},
    {"id": "q003", "category": "basic", "level": 1, "difficulty": "easy", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["좋다", "불가능", "안타깝다", "무례"]},
    {"id": "q004", "category": "basic", "level": 1, "difficulty": "medium", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "B", "choices": ["알려주다", "모르다", "결심", "평가"]},
    {"id": "q005", "category": "basic", "level": 1, "difficulty": "easy", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["우유", "에어컨", "사진기", "직인"]},
    {"id": "q006", "category": "basic", "level": 1, "difficulty": "easy", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "B", "choices": ["장마", "하늘", "일출", "일몰"]},
    {"id": "q007", "category": "basic", "level": 1, "difficulty": "medium", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["지도", "샛길", "사거리", "언덕"]},
    {"id": "q008", "category": "basic", "level": 1, "difficulty": "medium", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "B", "choices": ["연구", "복습", "견습", "검사"]},
    {"id": "q009", "category": "basic", "level": 1, "difficulty": "medium", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["십", "얼마", "십억", "일시불"]},
    {"id": "q010", "category": "basic", "level": 1, "difficulty": "medium", "question": "이 기초 단어 수어의 의미는 무엇인가요?", "correct": "C", "choices": ["더디다", "막히다", "가깝다", "사라지다"]},
    {"id": "q011", "category": "daily", "level": 2, "difficulty": "easy", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["공항", "서울역", "백화점", "보건소"]},
    {"id": "q012", "category": "daily", "level": 2, "difficulty": "easy", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "C", "choices": ["기차", "막차", "서울역", "공항"]},
    {"id": "q013", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "C", "choices": ["검사", "체온", "보건소", "회복"]},
    {"id": "q014", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["대출", "일시불", "지불하다", "빌리다"]},
    {"id": "q015", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "C", "choices": ["받다", "주다", "지불하다", "빌리다"]},
    {"id": "q016", "category": "daily", "level": 2, "difficulty": "easy", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["에어컨", "하늘", "장마", "우유"]},
    {"id": "q017", "category": "daily", "level": 2, "difficulty": "easy", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["배고프다", "급하다", "난감하다", "형편없다"]},
    {"id": "q018", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "B", "choices": ["기차", "막차", "사거리", "지름길"]},
    {"id": "q019", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["알려주다", "봐주다", "돕다", "무시하다"]},
    {"id": "q020", "category": "daily", "level": 2, "difficulty": "medium", "question": "일상 회화에서 쓰는 이 수어의 의미는 무엇인가요?", "correct": "A", "choices": ["포기", "회복", "쓰러지다", "퇴사"]},
]


def firestore_string(value):
    return {"stringValue": value}


def firestore_int(value):
    return {"integerValue": str(value)}


def build_body(item):
    return {
        "fields": {
            "questionText": firestore_string(item["question"]),
            "choices": {
                "arrayValue": {
                    "values": [firestore_string(choice) for choice in item["choices"]]
                }
            },
            "correctChoiceId": firestore_string(item["correct"]),
            "videoUrl": firestore_string(""),
            "isActive": {"booleanValue": True},
            "level": firestore_int(item["level"]),
            "category": firestore_string(item["category"]),
            "categoryLabel": firestore_string("기초 단어" if item["category"] == "basic" else "일상 회화"),
            "difficulty_level": firestore_string(item["difficulty"]),
            "attempt_count": firestore_int(0),
            "correct_count": firestore_int(0),
            "wrong_count": firestore_int(0),
        }
    }


def main():
    gcloud = "gcloud.cmd" if os.name == "nt" else "gcloud"
    token = subprocess.check_output([gcloud, "auth", "print-access-token"], text=True).strip()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }

    for item in QUIZ_ITEMS:
        data = json.dumps(build_body(item), ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{BASE_URL}/{item['id']}",
            data=data,
            headers=headers,
            method="PATCH",
        )
        with urllib.request.urlopen(request, timeout=30):
            pass

    print(f"Updated {len(QUIZ_ITEMS)} quiz_items documents.")


if __name__ == "__main__":
    main()
