# 包哥 動作素材 — PREVIEW v4（430px）（預覽級）

接入方案：包哥永遠站在 v2 地板（灶身與竹籠座下緣以下），不往上走，螢幕站高 430px（約 1080 的 40%），scale 0.6656，蹲姿同倍率。手搆不到高處時，由工程畫物件飛行：漿弧、彈蓋、粿飛入托盤、粿飛入籃。
所有 world 與 local 座標都是從 1920×1080 原圖目測估計（約 ±10px），需要在引擎內微調，**未經像素級驗證**。

## 規格
- 每格 768×768 RGBA，腳錨點 (384,720)，下方 48px 透明 padding。蹲姿錨點相同。
- scale 0.6656（站高 646 → 430px）。
- 換算：world = foot + 0.6656 × (local − anchor)。
- 場景：../stage-traditional-stove-mobile-v2.jpg（與 baoji-kitchen-stage/09 同圖）。

## 檔案
- pour/：**工程預設 baoge-pour-engine-sheet.png**（f1、f2-nostream、f3）；baoge-pour-sheet.png 只是備用（f2 烘焙了液流，不是工程預設）
- fan/：f1–f3、sheet，可循環
- lid/：f1–f3、sheet
- take/：f1–f3、sheet
- serve/：f1–f4、sheet（**4 格 3072×768**）。f3 托盤上還有粿（release_point），f4 是空盤：從 f3 局部 inpaint 去掉粿，人物與托盤位置跟 f3 相同。
- swat/：f1–f3、sheet
- contact-sheet.png
- preview/：
  - world-points-check.jpg（場景點位與地板多邊形）
  - stations-overview.jpg（四站位總覽）
  - station-stove_front-pour.jpg、station-stove_front-lid.jpg、station-bamboo_front-take.jpg、station-fan_crouch.jpg、station-serve.jpg
  - 預覽圖中的虛線是工程動作示意，不是角色素材內容。
- manifest.json：world_points、floor_standable_polygon、stations（foot 與各幀 world 點）、local_points、offsets_from_anchor、props（body_held 與 engine_moving 分開列）
- draft-v1/：舊初稿與舊規劃框對位（已棄用，非接入規格）

## 四站位（foot world）
| 站位 | foot | 用途 |
|---|---|---|
| stove_front | (700,1010) | 灶前地板，對左小、中大兩個鋁籠 |
| bamboo_front | (1440,915) | 竹籠座右前方地板，避開地上的扇子 |
| fan_crouch | (850,975) | 蹲姿，正對中間爐口 |
| serve | (560,1005) | 紅籃右側 |

## 場景目標（world，目測）
- 左小鋁籠：籠口 (502,416)，蓋鈕 (497,356)
- 中大鋁籠：籠口 (793,221)，蓋鈕 (793,174)
- 竹籠塔：上蓋籠口 (1159,285)，蓋鈕 (1161,253)。只有上蓋看得出可打開。seam_1–5（約 y366/435/497/572/647）只是視覺分層線，可當分層候選點，但圖上不是可打開的籠口。
- 爐口：中心 (947,600)，下緣 (950,705)
- 紅籃：口緣中心 (253,802)，落點 (253,830)
- 地上扇子 bbox：(1012,656)–(1294,881)，不可站
- 可站地板多邊形見 manifest

## 時間窗（工程交接）
1. 倒漿：用 engine sheet（f1、f2-nostream、f3）。engine 只在 f2-nostream 顯示期間畫漿弧（ladle_mouth→籠口），f3 前結束。不要和有液流的 f2 同時使用。
2. 揭蓋：三格都畫了握著的蓋子。「顯示 f2 同時讓 engine 蓋彈起」仍會出現兩個蓋子，**未解決**。可行做法：角色持蓋動畫期間，engine 蓋必須隱藏。若一定要讓蓋從籠口彈到手上：彈飛階段先顯示 idle，蓋到手的那一刻隱藏 engine 蓋，再切換 lid f1→f2→f3。另外，場景背景裡籠上原本的蓋子仍烘焙在圖上、未清除，需要 engine 遮罩或拆成獨立背景物件。這批角色圖**沒有**解決這點。
3. 拿粿：engine 粿飛行期間顯示 idle（目前沒有空手持盤的姿勢）。粿到手的同一刻隱藏 engine 粿，切換 take f1→f2→f3，避免出現兩塊粿。
4. 出餐：播 f1→f2→f3。f3 切到 f4 的那一刻，在 f3 release_point 的 world 座標 spawn 一塊獨立的粿，飛到 red_basket_drop。f4 為最後一格。

## 限制
- 座標都是目測。漿弧、蓋子、粿的飛行都要工程調整。
- 竹籠前與灶前兩個站位，角色離籠口很遠，靠工程弧線連接，屬預期設計。
- 各格臉部有生成造成的小差異，保留未統一，因為重畫會破壞動作連貫。
- f4 空盤是 inpaint：盤面略模糊，左手拇指旁有輕微膚色暈染。
- pour f1 勺口有短滴殘留。
- fan、swat 的比例是用髮量估算。
- 粿的外型參考方粿 icon；沒有找到「粿六狀態」素材。

## v4 尺寸調整（430px）
- 四個站位腳底沿用 v3：stove_front (700,1010)、bamboo_front (1440,915)、fan_crouch (850,975)、serve (560,1005)。放大後用 Read 檢查過，腳都在地板帶內，頭與道具沒有被裁切。
- 輕微重疊（如實記錄）：
  - serve：身體疊在灶身左下前方，托盤蓋住紅籃右上角一小塊。紅籃主體仍可辨識、可點。
  - fan：蹲姿疊在灶身前下方，爐口火焰完整可見。
  - stove_front：倒漿姿勢疊在灶面前方，沒有擋到鋁籠口。
- stations-overview.jpg 只是位置總覽。每個站位是獨立的遊戲狀態，遊戲中不會同時出現 4 個包哥。
- 舊的 360px 預覽、manifest 與 README 已移到 draft-v3-size360/。
