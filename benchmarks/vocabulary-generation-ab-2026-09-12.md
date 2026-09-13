# Vocabulary paragraph generation A/B benchmark — 2026-09-12

## Method

- API: `POST /api/ai/generate-paragraph` through a dedicated local Fastify instance.
- Provider: `ollama` at the repository-configured local network endpoint.
- Models: `qwen3:8b` and installed tag `qwen38-27b-iq3s:latest` (reported below as `qwen38-27b-iq3s`).
- Execution: serial, one request per case per model, with identical words and order.
- Prompt, validation, and single correction retry: unchanged application behavior.
- Thinking/reasoning: disabled normal generation. The application's Ollama `/api/generate` request shape returned no reasoning field; a preflight comparison with explicit `think:false` confirmed the same response behavior.
- Latency: client-observed end-to-end wall time, including model discovery, generation, validation, and correction retry when used.
- Retry status: taken from the application's `vocabulary_generation_validation` logs.
- No subjective writing-quality scoring was performed.

## Summary

| Model | Success rate | First-pass success rate | Correction retries | Average latency |
|---|---:|---:|---:|---:|
| `qwen3:8b` | 6/7 (85.7%) | 5/7 (71.4%) | 2 | 2.690 s |
| `qwen38-27b-iq3s` | 5/7 (71.4%) | 4/7 (57.1%) | 3 | 4.938 s |

Average latency includes final 502 requests.

## Fixed cases

| Case | Words |
|---|---|
| 2 related words | `calm`, `peaceful` |
| 2 unrelated words | `telescope`, `jealous` |
| 5 mixed words | `adapt`, `fragile`, `community`, `unexpected`, `approve` |
| 10 mixed words | `harbor`, `whisper`, `efficient`, `doubt`, `restore`, `curious`, `deadline`, `generous`, `obstacle`, `wander` |
| noun + verb | `lantern`, `negotiate` |
| abstract vocabulary | `justice`, `uncertainty`, `resilience` |
| multi-word expression | `take into account` |

## Request results

### `qwen3:8b`

#### 2 related words

- Words: `calm`, `peaceful`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 5.243 s
- English: The calm morning was peaceful, making it perfect for a walk. I decided to take a longer route to enjoy the scenery. As I walked, the quiet surroundings helped me feel relaxed. I noticed a small pond with ducks swimming around. The peaceful atmosphere made me want to sit and watch them for a while.
- Chinese: 那个平静的早晨很宁静，非常适合散步。我决定走更长的路线来欣赏风景。当我散步时，安静的环境让我感到放松。我注意到一个有鸭子游泳的小池塘。宁静的氛围让我想坐下来看着它们一段时间。

#### 2 unrelated words

- Words: `telescope`, `jealous`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 1.193 s
- English: Last night, I used my telescope to observe the stars. My neighbor, however, became jealous when he saw my telescope. He asked me to share my view, but I refused. Now, he's angry and refuses to talk to me. I feel bad, but I prefer to keep my telescope private.
- Chinese: 昨晚，我用望远镜观察星星。然而，我的邻居看到我的望远镜后变得嫉妒。他要求我分享我的视野，但我拒绝了。现在，他生气了，不愿和我说话。我感到难过，但我更喜欢保留我的望远镜。

#### 5 mixed words

- Words: `adapt`, `fragile`, `community`, `unexpected`, `approve`
- Result: success (HTTP 200)
- Correction retry required: yes (first output was not valid JSON; retry passed)
- End-to-end latency: 3.508 s
- English: The community decided to adapt their plans after an unexpected storm damaged several homes. The fragile roofs needed immediate repair, but the team lacked tools. A local carpenter offered help, and the group approved the plan to rebuild together. Working side by side, they strengthened the structures and restored hope. This experience highlighted the power of cooperation, showing that unity can overcome even the most challenging obstacles.
- Chinese: 社区决定在一场意外的风暴损坏了几栋房屋后调整他们的计划。脆弱的屋顶需要立即修理，但团队缺乏工具。一位当地的木匠主动提供帮助，小组批准了共同重建的计划。他们齐心协力，加固了结构，恢复了希望。这次经历突显了合作的力量，表明团结可以克服甚至最艰难的障碍。

#### 10 mixed words

- Words: `harbor`, `whisper`, `efficient`, `doubt`, `restore`, `curious`, `deadline`, `generous`, `obstacle`, `wander`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes (both attempts missed `deadline` according to validation)
- End-to-end latency: 4.756 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

#### noun + verb

- Words: `lantern`, `negotiate`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 1.507 s
- English: Last night, I hung a lantern outside my window to light the path. However, the lantern's light attracted a curious cat, which started to circle around. I decided to negotiate with the cat by offering some treats. Eventually, the cat left, and I could enjoy the lantern's glow without interruption.
- Chinese: 昨晚，我在我窗户外面挂了一个灯笼来照亮路径。然而，灯笼的光吸引了好奇的猫，它开始绕着转圈。我决定用一些零食和猫协商。最后，猫离开了，我可以享受灯笼的光芒而不被打断。

#### abstract vocabulary

- Words: `justice`, `uncertainty`, `resilience`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 1.216 s
- English: Uncertainty about the future made it hard to plan, but justice for all required action. Resilience helped her push through, even when progress felt slow. Her efforts eventually led to positive change, showing that perseverance can overcome doubt.
- Chinese: 对未来的不确定性使得计划变得困难，但对所有人公正的要求需要采取行动。她的坚韧帮助她克服了困难，即使进展看起来缓慢。她的努力最终导致了积极的变化，表明坚持不懈可以克服怀疑。

#### multi-word expression

- Words: `take into account`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 1.405 s
- English: After working late, I decided to take into account my health by going for a walk. The fresh air made me feel better, but I still felt tired. I took a short break to drink water, which helped me regain energy. As I continued walking, I realized I needed to take into account my schedule to avoid overworking. Finally, I returned home, feeling refreshed and more balanced.
- Chinese: 工作到很晚后，我决定考虑自己的健康，去散步。新鲜的空气让我感觉好些了，但还是觉得累。我停下来喝水，这帮助我恢复了精力。继续散步时，我意识到需要考虑自己的时间安排，以避免过度工作。最后，我回到家，感觉清爽且更加平衡。

### `qwen38-27b-iq3s`

#### 2 related words

- Words: `calm`, `peaceful`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 10.019 s
- English: Before the meeting, I felt tense, so I took a slow walk by the lake to stay calm. The quiet water and soft breeze made the morning peaceful. A colleague called to say the meeting was delayed, which relaxed me even more. I replied that I would join later, then I sat on a bench. I listened to the birds and felt ready to work. In the end, the delay gave me a calm break before the project discussion.
- Chinese: 会议前，我感到紧张，所以我沿着湖边慢慢散步，让自己保持冷静。平静的水面和轻柔的微风让清晨很安宁。一位同事打电话来，说会议推迟了，这让我更加放松。我回复说她稍后再加入，然后坐到长椅上。我听着鸟鸣，感觉自己已经准备好工作了。最终，这次推迟给了我在项目讨论前一段平静的休息时间。

#### 2 unrelated words

- Words: `telescope`, `jealous`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 3.467 s
- English: Last weekend, I borrowed my cousin's telescope to look at the moon from our quiet backyard. My friend came over, and she seemed jealous because my telescope had a better view than hers. I invited her to share it, so we watched the moon together and laughed about our small rivalry.
- Chinese: 上周末，我借了表哥的望远镜，在安静的后院里看月亮。我的朋友也过来了，她似乎有点嫉妒，因为我的望远镜看得比她的更清楚。我邀请她一起用，于是我们一边看月亮，一边笑着聊起我们之间的小竞争。

#### 5 mixed words

- Words: `adapt`, `fragile`, `community`, `unexpected`, `approve`
- Result: success (HTTP 200)
- Correction retry required: yes (first output failed length, coverage, and `usedWords`; retry passed)
- End-to-end latency: 5.074 s
- English: The small community had to adapt quickly when a fragile bridge collapsed, an unexpected event that shocked everyone. Local leaders worked hard to approve a repair plan, and residents helped carry materials to the site. The situation was difficult, but the community stayed united and supported one another. This experience taught them that preparation and cooperation can turn a fragile moment into a stronger future.
- Chinese: 当一座脆弱的桥梁倒塌时，这个小社区不得不迅速适应，这一意外事件震惊了所有人。当地领导人努力批准了一项修复计划，居民们帮忙搬运材料到工地。情况很艰难，但社区保持团结，互相支持。这次经历教会他们，准备和合作可以将脆弱的时刻变成更强大的未来。

#### 10 mixed words

- Words: `harbor`, `whisper`, `efficient`, `doubt`, `restore`, `curious`, `deadline`, `generous`, `obstacle`, `wander`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 6.979 s
- English: Maya had a tight deadline, so she planned an efficient day at the quiet lake. She hoped to restore her focus after a busy week. A soft whisper from the wind made her curious about a hidden path. She began to wander along it, but a fallen branch became an obstacle. She felt a slight doubt about whether she should stop and help. Still, she moved the branch aside with a generous effort and cleared a small trail. Maya then returned to the lake, where she could finally work calmly. The lake seemed to harbor her quiet thoughts, so her worry faded. She finished early and smiled at the simple progress.
- Chinese: 梅娅的截止日期很紧，所以她计划在安静的湖边度过高效的一天。她希望忙碌一周后恢复专注。风中的低语让她对一条隐藏的小路感到好奇。她沿着小路漫步，但一根倒下的树枝成了障碍。她有点怀疑自己是否该停下来帮忙。尽管如此，她还是用尽力气把树枝挪开，清理出一条小径。之后梅娅回到湖边，终于能安心工作了。湖面似乎承载着她安静的思绪，因此她的担忧渐渐消散。她提前完成了任务，并为这份简单的进步而微笑。

#### noun + verb

- Words: `lantern`, `negotiate`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes (both attempts failed length and missed both requested words)
- End-to-end latency: 2.247 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

#### abstract vocabulary

- Words: `justice`, `uncertainty`, `resilience`
- Result: success (HTTP 200)
- Correction retry required: no
- End-to-end latency: 4.737 s
- English: When the neighborhood lost its library, the residents felt a strong sense of uncertainty. They worried that children would have fewer places to read and learn. Instead of accepting the change, the community showed resilience by starting a small book exchange in the park. Parents brought donated books, and volunteers organized shelves under a tree. The new corner was not perfect, but it felt fair and hopeful, giving the area a little more justice.
- Chinese: 当社区失去了图书馆后，居民们感到强烈的不确定。他们担心孩子们会少一个读书和学习的地方。社区没有接受这种变化，而是在公园里发起了一个小型图书交换活动，展现出了韧性。家长们带来捐赠的书，志愿者们在树下整理书架。这个新角落并不完美，但它显得公平而充满希望，让这片区域多了一点公正。

#### multi-word expression

- Words: `take into account`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes (both attempts failed length and missed the requested expression)
- End-to-end latency: 2.046 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

## Targeted 27B rerun with development-layer draft capture

Only the two previously failed `qwen38-27b-iq3s` cases were rerun. An external transparent development proxy recorded the raw Ollama response while the unchanged application API continued to supply the production prompt, validation, and retry behavior. Both reruns passed first-pass, so neither produced a rejected draft or correction attempt.

### noun + verb rerun

- Words: `lantern`, `negotiate`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 8.099 s
- Rejected draft: none
- English: During the festival, Maya wanted to hang a bright red lantern in the old courtyard. The ladder was wobbly, so she asked her brother to help. He wanted to choose a higher spot, but she wanted it lower for safety. They negotiated and agreed to fix it near the door. It glowed beautifully and made the evening feel warm.
- Chinese: 节日期间，玛雅想在老院子里挂一盏鲜红的灯笼。梯子摇摇晃晃，所以她请哥哥帮忙。他想选一个更高的地方，但她想挂低一点以保证安全。他们商量后同意把它固定在门附近。灯笼发出美丽的光芒，让夜晚感觉温暖。

### multi-word expression rerun

- Words: `take into account`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 3.803 s
- Rejected draft: none
- English: When Maria planned the team picnic, she tried to take into account every preference. Some members wanted games, while others preferred quiet food and shade. She arranged a large table, a tent, and enough snacks for all. The weather turned rainy, so the plan changed slightly. Even then, everyone enjoyed the meal and felt included in the decision.
- Chinese: 当玛丽亚计划团队野餐时，她试图考虑到每个人的喜好。一些成员想要玩游戏，而另一些人更喜欢安静的食物和阴凉处。她安排了一张大桌子、一顶帐篷和足够的零食。天气突然下起雨来，所以计划稍微改变了。即便如此，每个人都享用了这顿饭，并且觉得自己被纳入了决定之中。

## Qwen3.8-27B IQ3_S 40K default f16 KV benchmark

Model: `qwen38-27b-iq3s-40k:latest`. This run used Ollama's default f16 KV cache because `OLLAMA_KV_CACHE_TYPE` was unset; it was not a q4_0 KV run. Flash Attention was left at Ollama's default/automatic behavior and was not confirmed. Each of the same seven fixed cases was run once through the unchanged Fastify API. The previous `qwen38-27b-iq3s` figures below are references to the already-recorded baseline; no baseline requests were rerun.

### Summary and existing baseline reference

| Model/run | First-pass success rate | Final success rate | Retry count | Final 502 count | Average latency | Median latency |
|---|---:|---:|---:|---:|---:|---:|
| `qwen38-27b-iq3s-40k:latest` | 4/7 (57.1%) | 4/7 (57.1%) | 3 | 3 | 4.734 s | 4.159 s |
| Existing `qwen38-27b-iq3s` baseline | 4/7 (57.1%) | 5/7 (71.4%) | 3 | 2 | 4.938 s | 4.737 s |

Latency statistics include final 502 requests. No subjective quality scoring was performed.

### 2 related words

- Words: `calm`, `peaceful`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes
- End-to-end latency: 7.032 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

### 2 unrelated words

- Words: `telescope`, `jealous`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 3.865 s
- English: Last Saturday, a friend and I visited a small planetarium, where we watched stars through a telescope. I was jealous when the guide let him ask the first question. However, I waited patiently and also received a clear answer. Finally, we both felt proud and enjoyed the evening together.
- Chinese: 上周六，我和一个朋友去了一个小天文馆，用望远镜观看星星。当讲解员让朋友先提问时，我有点嫉妒。不过，我耐心等待，也得到了清晰的回答。最后，我们俩都感到自豪，一起享受了这个夜晚。

### 5 mixed words

- Words: `adapt`, `fragile`, `community`, `unexpected`, `approve`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 5.911 s
- English: When a new bakery opened near our quiet neighborhood, the community was excited about fresh bread and coffee. However, the owner soon had a fragile business because many residents were not sure what to order. One morning, a regular customer noticed a small mistake on a menu and suggested a simple change. The owner adapted the menu, and the staff learned to explain the choices more clearly. This unexpected kindness helped people feel confident, so more families began visiting each week. Finally, the local board approved the bakery’s plan to host a small weekend market, which made the shop feel even more connected to its neighbors.
- Chinese: 当一家新面包店在我们安静的社区附近开业时，社区里的人们对新鲜面包和咖啡感到兴奋。然而，由于许多居民不确定该点什么，店主很快发现生意很脆弱。一天早上，一位常客注意到菜单上的一个小错误，并建议做一个简单的修改。店主调整了菜单，员工也学会了更清楚地介绍各种选择。这种意想不到的善意让人们感到更有信心，因此每周都有更多家庭前来光顾。最后，当地委员会批准了面包店举办小型周末市集的计划，这让店铺与邻居们的联系更加紧密。

### 10 mixed words

- Words: `harbor`, `whisper`, `efficient`, `doubt`, `restore`, `curious`, `deadline`, `generous`, `obstacle`, `wander`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes
- End-to-end latency: 6.850 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

### noun + verb

- Words: `lantern`, `negotiate`
- Result: final HTTP 502 (`AI_GENERATION_INVALID_RESPONSE`)
- Correction retry required: yes
- End-to-end latency: 2.023 s
- English: unavailable; rejected drafts are not exposed by the application API
- Chinese: unavailable; rejected drafts are not exposed by the application API

### abstract vocabulary

- Words: `justice`, `uncertainty`, `resilience`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 4.159 s
- English: After losing his job, Marco felt a deep sense of uncertainty. He worried about paying rent, so he applied for a temporary job at a local bakery. The manager approved his request, which gave him some confidence. Even though the work was hard, his resilience helped him adapt quickly. By the end of the month, he had saved enough money to feel more secure. This small victory reminded him that justice sometimes comes through effort, not luck.
- Chinese: 失业后，马可感到深深的迷茫。他担心房租，于是申请了当地一家面包店的临时工作。经理批准了他的请求，这让他有了一些信心。虽然工作很辛苦，但他的韧性让他很快适应。到月底，他攒够了钱，感觉更安稳了。这个小小的胜利提醒他，公平有时来自努力，而非运气。

### multi-word expression

- Words: `take into account`
- Result: success (HTTP 200), passed first-pass
- Correction retry required: no
- End-to-end latency: 3.294 s
- English: When planning a school trip, teachers must take into account the weather, safety rules, and student interests. They also need to consider the budget and travel time. By doing this, the trip becomes smoother and more enjoyable for everyone involved.
- Chinese: 在计划学校旅行时，老师必须考虑天气、安全规则和学生兴趣。他们还需要考虑预算和旅行时间。这样做可以让旅行更加顺利，让每个人都更享受。

## Qwen3.8-27B IQ3_S context/memory benchmark — RTX 5070 Ti 16GB

Measured observations and estimates are labeled explicitly. `Ollama ps PROCESSOR` is reported exactly as observed and must not be interpreted as a model-layer offload percentage. A dash means the value was not recorded.

| Configuration | Context | KV type | Flash Attention | Model GPU MiB | KV MiB | RS MiB | Compute MiB | Projected GPU MiB | GPU layers | Ollama ps SIZE | Ollama ps PROCESSOR | Notes |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Original/default Ollama | 4K | default f16 | default/automatic; not confirmed | — | — | — | — | — | — | ~11 GB (measured) | 100% GPU (measured) | `OLLAMA_KV_CACHE_TYPE` unset |
| Original/default Ollama | 40K | default f16 | default/automatic; not confirmed | — | — | — | — | — | — | ~14 GB (measured) | 100% GPU (measured) | `OLLAMA_KV_CACHE_TYPE` unset; vocabulary generation run above used this configuration |
| Original/default Ollama | 48K | default f16 | default/automatic; not confirmed | — | — | — | — | — | — | ~15 GB (measured) | 6%/94% CPU/GPU (measured) | `OLLAMA_KV_CACHE_TYPE` unset; PROCESSOR is not layer offload |
| Original/default Ollama | 64K | default f16 | default/automatic; not confirmed | — | — | — | — | — | — | ~16 GB (measured) | 14%/86% CPU/GPU (measured) | `OLLAMA_KV_CACHE_TYPE` unset; PROCESSOR is not layer offload |
| Original/default Ollama | 96K | default f16 | default/automatic; not confirmed | — | — | — | — | — | — | ~18 GB (measured) | 24%/76% CPU/GPU (measured) | `OLLAMA_KV_CACHE_TYPE` unset; PROCESSOR is not layer offload |
| Explicit q4_0 KV + Flash Attention | 49152 | q4_0 | enabled | 10616.86 (measured) | 864.00 (measured) | 149.63 (measured) | 320.28 (measured) | 11950 (estimated) | 66/66 (measured) | — | — | All layers offloaded to GPU |
| Explicit q4_0 KV + Flash Attention | 98304 | q4_0 | enabled | 10616.86 (measured) | 1728.00 (measured) | 149.63 (measured) | 560.28 (measured) | 13054 (estimated) | 66/66 (measured) | — | — | Estimated remaining GPU memory: 1834 MiB; all layers offloaded to GPU |
| Explicit q4_0 KV + Flash Attention | 131072 | q4_0 | enabled | 10616.86 (measured) | 2304.00 (measured) | 149.63 (measured) | 720.28 (measured) | 13790 (estimated) | 66/66 (measured) | — | — | Estimated remaining GPU memory: 1098 MiB; only 74 MiB above Ollama's 1024 MiB fit reserve threshold; all layers offloaded to GPU |
