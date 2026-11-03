# 마스코트 이미지 프롬프트 — 꿀벌 "꿀짓이"

## 왜 꿀벌인가

- 꿀벌은 **몸짓(8자 춤)으로 말한다.** 꽃의 방향과 거리를 소리 없이 춤으로 동료에게 알린다. 손짓으로 말하는 수어와 같은 이야기다.
- 꽃과 꽃 사이를 오가며 이어 준다. 들리는 사람과 들리지 않는 사람 **사이를 이어 주는 존재**라는 뜻을 담는다.
- 노랑: 따뜻함, 그리고 지켜 준다는 느낌(노란 우산 · 어린이 보호구역). 앱의 중심 색과 같다.
- 한 문장: "소리 없이 몸짓으로 말하는 꿀벌처럼, 소리가 없어도 마음이 닿게."

## 캐릭터 설정

- 이름(가안): 꿀짓이 — 꿀벌 + 손짓
- 몸: 말랑하고 통통한 둥근 몸, 따뜻한 꿀색 노랑(#FFD255), 부드러운 갈색 줄무늬 두 줄(#6B4A2B), 배는 크림색
- 날개: 작고 반투명한 하늘빛 날개 두 장, 하트에 가까운 둥근 모양
- 더듬이 두 개, 끝은 동그란 방울
- **손: 팔 두 개만 보이게 하고, 손가락 다섯 개가 또렷한 큰 손.** 다리는 짧고 통통하게 두 개만 (실제 꿀벌처럼 여섯 개로 그리지 않는다)
- 얼굴: 큰 눈 + 하이라이트, **진한 눈썹**(표정 전달용), 작은 입, 주황빛 볼
- 침은 그리지 않는다 (아프거나 무서운 느낌을 빼기 위해)
- 2.5등신. 머리가 너무 크면 얼굴 앞 수어를 손이 가린다
- 성격: 호기심 많고 같이 배우는 친구. 선생님 아님

## 공통 규격 (앱에 넣기 위해)

- PNG, 투명 배경, 1024×1024
- 캐릭터가 가운데, 위아래 여백 10% 정도, 모든 장 같은 크기와 시점(정면 약간 3/4)
- 첫 장(기본)을 레퍼런스로 넣고 나머지를 만들어야 색과 비율이 같게 나온다
- 파일은 `frontendcodes/assets/mascot/`에 두고 `components/mascot.tsx`의 `MASCOT_IMAGES`에 연결한다

## 1. 기본 캐릭터 (첫 장, 레퍼런스용)

```
A cute, lively 3D mascot character for a Korean sign language learning app: a chubby little honeybee named Kkuljit.
Round, soft, squishy body, 2.5 heads tall, warm honey-yellow (#FFD255) with two soft chocolate-brown stripes (#6B4A2B), cream-colored belly.
Two small translucent pale-sky-blue wings, rounded almost heart-shaped, slightly blurred as if fluttering.
Two antennae with little round bobbles on the tips.
Only two arms, with large expressive hands that have exactly five clearly separated fingers and rounded fingertips, slightly oversized compared to the body.
Two short chubby legs. No stinger.
Big shiny eyes, thick expressive eyebrows, small mouth, warm orange-peach cheeks.
Friendly, curious, energetic pose: hovering slightly above the ground, waving hello with one hand, head tilted, body leaning forward.
Soft vinyl toy / clay 3D render, subsurface scattering, warm soft studio lighting, gentle golden rim light, cozy warm pastel colors.
Full body, centered, front 3/4 view, transparent background, no text, no logo.
```

네거티브 (지원되는 도구라면):

```
six legs, insect legs, stinger, mitten hands, four fingers, fused fingers, gloves, missing eyebrows, realistic insect, scary, aggressive, text, watermark, logo, busy background, cropped body
```

## 2. 표정 세트 (같은 캐릭터, 1장씩)

첫 장을 레퍼런스로 넣고 `<…>` 자리만 바꿔 붙인다.

```
Same character as the reference image, same colors, same proportions, same lighting, full body, centered, transparent background.
Pose and expression: <…>
```

| 파일 이름 | 쓰는 곳 | `<…>`에 넣을 문장 |
|---|---|---|
| `kkuljit-hello.png` | 홈 인사 | waving hello with one hand, big smile, eyebrows raised happily, wings fluttering |
| `kkuljit-correct.png` | 퀴즈 정답 | flying upward with both arms up, fingers spread wide, eyes closed in joy, little sparkles and a tiny figure-eight motion trail behind |
| `kkuljit-wrong.png` | 퀴즈 오답 | small shrug, hands open palms up, eyebrows tilted in a gentle "oops", soft smile, antennae slightly drooping, not sad |
| `kkuljit-cheer.png` | 목표 응원 | both fists raised in a cheering pose, determined eyebrows, confident grin, wings spread |
| `kkuljit-thinking.png` | 번역 로딩 | one hand on chin, index finger tapping, eyes looking up, eyebrows slightly furrowed, one antenna curled like a question mark |
| `kkuljit-celebrate.png` | 오늘 목표 달성 | holding a small golden honey-drop star above head with both hands, very happy, confetti and tiny flowers |
| `kkuljit-sleepy.png` | 기록 없음 | sitting on a small flower, rubbing one eye with a hand, yawning, wings folded, relaxed eyebrows |

오답 표정은 "슬픔"이 아니라 "앗, 괜찮아"로 잡는다. 틀려도 다시 풀고 싶게.

## 3. (선택) 움직임용

```
Same character and pose as the reference image, identical in every way except the eyes are closed in a natural blink.
```

```
Same character and pose as the reference image, identical in every way except the wings are in the opposite flap position.
```

두 장을 번갈아 보여 주면 눈 깜빡임과 날갯짓이 된다.

## 주의

- 이미지 도구는 손가락을 자주 틀린다. 네 개거나 붙어 나온 장은 다시 만든다.
- 실제 수어 동작은 이미지 도구가 정확히 그리기 어렵다. 정확한 수어는 2학기 3D 아바타가 맡는다.
- 잘 알려진 꿀벌 캐릭터와 비슷해 보이면 다시 만든다.
