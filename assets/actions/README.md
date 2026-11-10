# 包哥 動作素材 — PREVIEW v6（場景品質重繪：一次生成 + 垂直版面擬合）

接入方案：包哥站高 560px（scale 0.866873 = 560/646），腳底在地板（預設 y=1030），全身可見。灶台面在腰部（y=740，從腳底算 0.518 身高）。工程預設場景是**無蓋空籠口**；蓋子是獨立透明 PNG。倒漿、揭蓋、拿粿、出餐的交接規則與 v4/v5 相同，見下方與 manifest `handover_rules`。

所有 world 座標都是從 1920×1080 原圖目測估計（約 ±8px），需要在引擎內微調，**未經像素級驗證**。

## 規格
- 每格 768×768 RGBA，腳錨點 (384,720)，下方 48px 透明 padding。蹲姿錨點相同。v6 **沒有**放大畫布。
- scale 0.866873（站高 646 → 560px）。
- 換算：world = foot + 0.866873 × (local − anchor)。
- 觸控 bbox 短邊必須 ≥140 design px（以 1920 寬橫向手機、約 64pt × 2.2 寫入的假設；不是 64pt 本體，也不是其他門檻）。籠／爐口／紅籃皆依此檢查。
- 場景（工程預設，無蓋）：`scene/scene-lidless.jpg`（相對素材包）。同圖亦在：
  - `/home/box/game-art-refs/stage-traditional-stove-mobile-v3-scale.jpg`
  - `/home/box/game-art-refs/baoji-kitchen-stage/09-stage-traditional-stove-mobile-v3-scale.jpg`
- 有蓋預覽（非工程預設）：`scene/scene-with-lids.jpg`
- 蓋子 PNG：`scene/lid-aluminum.png`、`scene/lid-bamboo.png`（與新籠口橢圓同透視、同比例）。各籠放置見 manifest `cages[]`。
- **v2 場景未覆寫**。v5 合成稿備份在 `draft-v5-composite/`。v4 的 manifest / README / preview 在 `draft-v4-size430/`。舊版小蓋在 `draft-v4-size430/lid-original/`。

> 新場景是單張預覽底板。來源是 GenerateImage 一次生成的 16:9 連貫無人物畫（完整不切邊的水泥雙灶、六個空籠可見籠口內部、爐火、紅籃、圓竹扇自然落地、透視一致，沒有拼貼道具）。之後只對**整張畫**做分段垂直版面擬合：蒸籠+台面下移 75px（比例 1.0），灶身壓縮，讓台面落在 y=740、灶身底約 y=928（目標 900–940，在人後方地板）。不是把紅籃或扇另外貼上去。舊的 05b 前景層、04 灶層等**未重做、不再對應**這張 v3-scale 場景。

## 檔案
- pour/：**工程預設 baoge-pour-engine-sheet.png**（f1、f2-nostream、f3）；baoge-pour-sheet.png 只是備用（f2 烘焙了液流，不是工程預設）
- fan/：f1–f3、sheet，可循環
- lid/：f1–f3、sheet。手持鋁蓋與場景鋁蓋在角色 scale 下同比例（畫布蓋寬 212px ≈ 184 螢幕 px / 0.8669）。人物未重畫。f1、f2 已從原始小蓋格重合成（去掉舊鐘形蓋、保護手、貼上新蓋並對齊握點）以修殘縫；f3 沿用 v5 已較乾淨的底面蓋（畫布與腳錨不變）。
- lid-bamboo-held/：可選竹蓋手持 f1–f3 與 sheet（f1/f2 同樣重合成，f3 沿用）
- take/：f1–f3、sheet
- serve/：f1–f4、sheet（**4 格 3072×768**）。f3 托盤上還有粿（release_point），f4 是空盤。
- swat/：f1–f3、sheet
- scene/：無蓋工程場景、鋁蓋、竹蓋、有蓋預覽
- preview/：
  - stations-overview.jpg（**僅站位總覽**，不是遊戲畫面，四站不會同時出現）
  - game-screen-single-baoge.jpg（只有一個包哥、無 debug 標線、無虛構 HUD）
  - world-points-check.jpg（籠口／爐口／籃／扇／可站地板，工程對位用）
- manifest.json
- draft-v5-composite/、draft-v4-size430/、draft-v3-size360/、draft-v1/：舊版封存

## 四站位（foot world）
| 站位 | foot | 用途 |
|---|---|---|
| stove_front | (665,1030) | 鐵/鋁籠前，對 iron_1..3 |
| bamboo_front | (1250,1030) | 竹籠前，對 bamboo_1..3 |
| fan_crouch | (1100,1030) | 蹲姿，正對右側爐口（有火） |
| serve | (450,1030) | 紅籃前方偏右 |

## 六個籠位（籠口中心 / 對應站位）
| id | 種類 | 籠口中心 | 籠徑 | 觸控短邊 | 站位 | 倒漿目標 |
|---|---|---|---|---|---|---|
| iron_1 | 鋁 | (470, 588) | 180 | 140 | stove_front | 同籠口 |
| iron_2 | 鋁 | (665, 588) | 178 | 140 | stove_front | 同籠口 |
| iron_3 | 鋁 | (864, 588) | 176 | 140 | stove_front | 同籠口 |
| bamboo_1 | 竹 | (1061, 588) | 174 | 140 | bamboo_front | 同籠口 |
| bamboo_2 | 竹 | (1250, 588) | 172 | 140 | bamboo_front | 同籠口 |
| bamboo_3 | 竹 | (1436, 588) | 168 | 140 | bamboo_front | 同籠口 |

竹籠是三個各自有蓋的矮兩層籠，排成一列，**不是**一座高塔的分層線。蓋子放置中心、paste、尺寸見 manifest `cages[]`。

爐口（右側有火為主互動）：fire_r 開口約 (1190,786)–(1375,882)，開口高約 96px；觸控 bbox 短邊 **140**（含砌石框 padding）。左側暗爐口 fire_l 開口高約 100px，觸控短邊 140。紅籃頂 y=848（膝線 879 上方 31px），高 158，觸控短邊 158，落點見 `red_basket_drop`。

## 比例驗證（從腳底算；肩寬 152px）
| 項目 | 目標 | 實測 | 結果 |
|---|---|---|---|
| 灶台面 / 身高 | 0.50–0.55 | (1030−740)/560 = **0.518** | 達成 |
| 鋁／竹籠徑 / 肩寬 | 1.0–1.5 | 1.105–1.184（徑 168–180） | 達成 |
| 竹籠頂 vs 頭頂 | 不超過頭太多 | 竹頂 y=556，頭 y=470，在頭**下方 86px** | 達成 |
| 紅籃 vs 膝 | 約到膝蓋 | 籃頂 y=848，膝上方 31px；高 158，籃高/膝高 1.046 | 大致達成（頂緣略高於膝線） |
| 觸控 bbox 短邊 | ≥140 design px | 籠 140、爐（砌石框 padding 後）140/140、籃 158 | 籠與籃達成；爐口**開口**短邊約 96–100，未達 140，觸控框靠砌石 padding 才到 140 |
| 灶身底 | 900–940，在人後方 | y=928，比腳底 1030 高 102px | 達成 |

## 時間窗（工程交接）
1. 倒漿：用 engine sheet（f1、f2-nostream、f3）。engine 只在 f2-nostream 顯示期間畫漿弧（ladle_mouth→該籠 pour_target），f3 前結束。不要和有液流的 f2 同時使用。
2. 揭蓋：三格都畫了握著的蓋子。角色持蓋動畫期間，engine 蓋必須隱藏。若一定要讓蓋從籠口彈到手上：彈飛階段先顯示 idle，蓋到手的那一刻隱藏 engine 蓋，再切換 lid f1→f2→f3。v6 背景是空籠口，用獨立蓋 PNG 依 `cages[]` 放置或隱藏。
3. 拿粿：engine 粿飛行期間顯示 idle。粿到手的同一刻隱藏 engine 粿，切換 take f1→f2→f3。
4. 出餐：播 f1→f2→f3。f3 切到 f4 的那一刻，在 f3 release_point 的 world 座標 spawn 一塊獨立的粿，飛到 red_basket_drop。f4 為最後一格。

## 限制與誠實紀錄
- 座標都是目測。漿弧、蓋子、粿的飛行都要工程調整。
- GenerateImage 原圖（scene C）已是連貫單張：灶完整不切邊、六個空籠可見內部、爐火、紅籃與圓竹扇自然落地、透視一致。但原圖台面約在 y=665（偏高）。為同時接近「台面 y=740、灶底 900–940」，對整張畫做分段垂直擬合（不是拼貼道具）。上牆略被拉長（掛鍋仍大致圓）、灶身與爐口被壓扁、地板帶略壓縮。接合處目測沒有明顯接縫。
- 爐口開口高度因此只有約 96–100px。觸控 ≥140 是靠砌石框 padding，不是開口本身。
- 紅籃頂比膝線高約 31px；籃身高度仍約等於膝高。
- 手持鋁蓋 f1、f2 已從原圖重合成，蓋面不再有 v5 那種破洞與舊蓋殘月；握點對準新蓋鈕。f3 是底面視角，沿用 v5 較乾淨的一張，未用俯視蓋硬換。可選竹蓋 f1/f2 同樣重合成，握把附近與右側與手臂交界仍可能有小殘邊。
- 牆面上掛的兩面圓蓋是裝飾，不是可揭的六個籠蓋。
- idle 畫布不同，引擎必須對齊腳底。
- 各格臉部有生成造成的小差異，保留未統一。
- f4 空盤是 inpaint：盤面略模糊。
- pour f1 勺口有短滴殘留。
- 粿的外型參考方粿 icon。
