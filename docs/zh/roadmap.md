# 路线图

0.21.10 已于 2026 年 9 月 23 日发布。项目会先持续完成可靠性发布，再进入 1.0.0 稳定性冻结。

## 0.21.10 已完成范围

- `heartbeatIntervalMs: Infinity`——文档中关闭 SharedWorker PING 心跳的方式——此前被回收器当成了一个
  畸形数字：它与 `NaN`、`0`、负数走同一道 `Number.isFinite` 检查，于是回退到默认 10 秒，也就给
  了这个"注定再也不会发消息"的端口安上一个 30 秒的会话超时。这个选项的本意是"不需要回收器"，结果却保证
  连接 30 秒后必被回收。`Infinity` 现在让该端口豁免于回收，而那三个连 transport 构造函数都会拒绝（因此
  根本不可能来自本库）的值仍走回退路径。用一个测试钉住：三个变异体分别死在三条不同断言上；另有一条断言钉住
  `INIT` 确实带着这个值——这个缺陷的两半各有绿灯测试覆盖，正是它活到今天的原因。
- 发布出去的回收器文档不再承诺代码没有做的事（中英双语）：不存在"SharedWorker 关闭时"运行的
  `PortReaper.dispose()` 钩子（没有任何地方调用它——`MessagePort` 没有 close 事件，因此压根没有可供挂靠的
  信号）；而关闭心跳的代价也和它关掉了什么一起写明了（这样配置的 Tab 若崩溃，其会话与 WebSocket 会原地保留）。
- 一个"测试全绿却把门禁弄红"的缺陷：IndexedDB 回放的一条断言在某个 await 之后才挂上 rejection handler，
  而那个 await 可能被真实的 40 毫秒定时器超过，于是在繁忙的 runner 上 `pnpm test:coverage` 会以
  `Unhandled Rejection` 退出 1，而所有测试都显示通过。现在 handler 与 promise 一起创建——把往返强行拉长到
  200 毫秒后两个方向都实测过。
- 没有改变线路格式、存储布局或集群协议。行为变化仅限于 shared 模式下配置 `heartbeatIntervalMs: Infinity`
  的情形，而那种配置此前根本无法按文档所说工作。

## 0.21.9 已完成范围

- 被饿死的 SharedWorker Tab 曾经会静默丢失 transport 并且永不恢复：一个长同步任务，或后台
  Tab 受到的定时器节流，都会让共享线程里的回收器收回该端口；而 `MessagePort` 没有 close
  事件、向已关闭端口发送消息会“成功”却什么都不送达，于是这个 Tab 仍在持有自己的路由、仍在
  报告 `healthy` / `connected`，而它发出的发布全部消失。现在回收器会在关闭端口前先在该端口上发出这次回收的通知，transport 把它当作一次普通的 backend 失效，于是既有的恢复流程会重建会话。
  真实浏览器两个方向都验证过：有通知时 36.7 秒自动重建，去掉通知后 90 秒内始终不恢复。
- 共享模式的所有权迁移此前完全没有浏览器级覆盖。现在三个共享 Tab 会固定住：关闭 owner 时，
  那条唯一的服务端订阅必须落到一条本来就早已打开的连接上，并且交接之后两个方向都仍能投递。
- 没有改动任何线格式、存储布局或集群协议版本：新增的消息只在页面与它自己的 Worker 之间流动，
  不认识该类型的主线程会直接忽略。

## 0.21.8 已完成范围

- 第二个随包分发的句子同样是错的，性质与 0.21.7 那条一致。`docs/api.md` 在中英文里都承诺任何公开 trace 事件都不包含原始 Topic，而 `docs/configuration.md` 在两种语言里写的恰恰相反，还进一步提醒接入方在把 sink 转发给遥测前对 Topic 名称脱敏。事实是：subscription 事件携带它所报告的 Topic，涉及具体路由的 `reliability` 操作也一样。修正后的文字只陈述测量到的东西：任何事件都不携带消息 payload、连接地址或错误正文；Topic 明文恰好只出现在这两种事件里；`coordination` 使用不可逆的 key 来标识路由。现在有一个测试把 payload 哨兵与错误正文哨兵穿过真实的 bus，并断言 sink 两者都看不到——这是这两条声明第一次拥有见证。
- 套件里那个长期被当作共享 runner 抖动的 E2E 失败并不是负载。shared 模式的下线用例断言的是 demo server 的全局连接数，而 specs 是并行跑的，其它存活 tab 都会被算进去；即便通过也是空过：一个 topic 只有 owner 的 transport 会订阅它的频道，所以「2」可能是一个持有频道的 socket 加上一个什么都没订阅的 socket。现在 socket 按各自持有的频道来寻址，用例也同时断言两半：关闭的 tab 的 socket 必须从服务器列表里消失，存活 tab 的那个必须仍在列表里。把该用例重复三次（旧断言下三次全败）现在能通过。
- 两个带种子的不变量 harness 分别跑到出厂深度的 80 倍与 133 倍（400,000 与 200,000 个种子，753.7 秒与 262.6 秒），没有发现任何破坏，因此剩下的零计数腿是分类工作，而不是隐藏的协同缺陷。它们的文件头现在记录了可用深度，以及能结束一次深跑的三道彼此独立的限制。
- 一个一直被读反的覆盖零值现在按它真正计量的东西标注：当 `??` 的兜底是一个箭头函数时，分支区间落在该闭包体内，所以这一臂统计的是被调用，而不是有多少调用方省略了参数。全仓库扫描下来，这是唯一一条这种形状的腿，规则已写进 `AGENTS.md`。
- 本次发布没有行为、线格式或存储布局的变更。

## 0.21.7 已完成范围

- 一处随包发布的说明是错的。`docs/api.md` 承诺「该 topic 最后一个 handler 退订时清空重放缓冲」，同时又说通配订阅会回放所有匹配 pattern 的已缓冲 topic——但 pattern 不是一个 topic：历史是按具体发布 topic 归档的，所以退订 `chat.*` 一条都不会清空，而 durable 清理拿到的是一个没有任何记录对应的键。中英文文档现在都写清了每次清理作用的键、`maxPerTopic` 限制的是每条环的深度而非环的数量，以及真正能回收内存的那几个调用。行为没有改动（按 pattern 剪枝会连带丢掉其它仍在线的订阅者拥有的环），并新增一条测试把这个边界钉住，避免文档再次漂回去。
- 补上一个真实的测试缺口：`ReplayManager` catch 中的 hydration epoch 检查从未执行过。`resetBuffers()` 只抬 epoch 不抬 retry generation，于是重置之后到达的加载失败会替「替换它的那个会话」上报错误，并把完成闩锁置位——那正是会抑制新会话加载的状态：一次幽灵 persistence error，外加该实例整个生命周期内 durable 历史缺失。
- 接收侧的帧校验规则（0.21.5 / 0.21.6）从维护者笔记搬进了 `docs/architecture.md` 的两个语言版本，包含两条刻意不做的检查，以及非 JS 对端要怎样才能被接受——这些守卫是 fail-closed 的，坏帧被静默丢弃且没有任何回应，对接方不看文档就无从知道。
- 五个模块里约十条 zero-count 分支用实验而不是推断定了下来：一条被真正钉住，其余的在原地处标注了「谁覆盖了它」以及删掉它的代价。没有删除任何一条，本次发布也没有声称任何未经测量的覆盖率提升。
- 覆盖率门禁重新变成了门禁：96 / 92 / 96 / 97 的下限已经比实测分支覆盖率低了 4.7 个百分点，意味着丢掉一整个模块的测试仍能通过包括发布门禁在内的所有检查。现在是 98 / 96 / 98 / 99，留出的余量只为唯一一个真正依赖运行机器的因素（模糊测试按墙钟界定深度），并且用「把阈值抬高到超过实测值就会失败」验证过它有牙齿。
- 本次发布没有改变任何行为、线格式或存储结构。


## 0.21.6 已完成范围

- 0.21.5 的协议修复其实只覆盖了读取这组字段的两个处理器之一。`ROUTE_RELEASED` ACK 的授权方式完全相同——依据 `topicKey` 对应的持久路由——然后把它携带的 `topic` 写入 `assignedTopics` 并让传输层订阅它；因此一个同源脚本只要从 localStorage 读到真实的 key、记录在案的前任 owner 和 generation，就能用任意频道名回应一次正在进行的交接。现在两个点对点处理器都会校验 `createOpaqueKey(topic) === topicKey`；`EVENT` 与 `REGISTRY` 不需要这条检查，因为它们不携带“key + 明文”这一对字段。
- 批量 `PUBLISH` 帧的 `items` 此前只做了真值加长度的判断，而 `publishBatch()` 的 `Array.prototype.map` 是唯一的产生者。手工构造的 `{ length: 2 }` 会让 `message.items is not iterable` 从集群自己的 `BroadcastChannel` 监听器里抛出；可迭代的 `"ab"` 会变成两条 `data` 为 `undefined` 的发布，并以接收方 worker 的会话发出；空数组则两半条件都不满足，落到单条发布分支上把 `undefined` 发出去一次。现在，携带 `items` 的帧必须给出非空数组。
- 账目上的一条是通过证明断言本身失效而关闭的：恢复次数耗尽的一次性上报，其第二处“`exhausted` 诊断只有一条”的计数从未进入过对应分支——因为一次失败的重开之后，安装到传输层上的处理器属于已被取代的生命周期。改成用应用在耗尽后真正会走的需求路径去驱动第二次失败，这个钉住才成立——现在删除该保护会让测试套件失败。`data-bus.ts` 未覆盖分支臂 13 → 12。
- `AGENTS.md` 把流程教训与不变式写在了一起：保护*协议*不变式的守卫属于协议，而不是最初发现违规的那个处理器，因此钉住一条不变式意味着枚举它约束的每个读取点——这正是上一版“修复”漏掉的那一步。

## 0.21.5 已完成范围

- 关闭的是协议漏洞，不是覆盖率条目：`handleControlMessage` 依据 `message.topicKey` 对应的持久路由来授权归属，随后却把 `message.topic` 当作明文去记忆、登记并交给 transport。由于 `topicKey` 就是 `createOpaqueKey(topic)`，任何同源脚本都能向集群的 `BroadcastChannel` 投递一帧“真的 key 配任意 topic”的消息：它以 key 为准的校验会通过，而接收方 worker 订阅的频道名被替换。现在除非两者一致，控制帧一律丢弃；本库自己构造帧时就是这样推导的，因此合规对端不受影响。
- 同一次审计对后续问题给出了相反方向的结论并写进文档：`EVENT` 只做形状校验，因为投递仍要求本地存在订阅者，伪造一帧最多只能往本标签已经关注的主题上投递一条发布——这没有超出同源脚本直接调用页面自身 bus 能做到的事。`AGENTS.md` 记录了这一区分，避免有人把它“加固”成破坏跨版本兼容。
- 明确了一条防挂起契约：`createStopPromise()` 的注释曾断言 `performStop()`“永不 reject”，因此 teardown 闸门的 rejection 分支从未被任何测试执行。它确实会 reject——其 `catch` 经由 `reportError()` 上报，而后者会运行错误订阅者，这些订阅者只靠写 `console.warn` 被吸收——在该路径上 `resolveGate()` 是唯一能让 `await bus.stop()` 结束的东西。注释现在写明这条链，测试则用看门狗与 stop 竞速，删掉这条分支会在 250ms 内明确失败，而不是变成一个超时。
- 这条上报路径的最后一环也被钉住：如果 console 上没有 `warn`，未加保护的日志调用会从“用于容纳失败的处理器”内部抛出 `TypeError`，穿过 dispatch 循环逃逸到 transport 的消息回调里。
- 测试框架的可诊断性，源自一次无法诊断的 CI 失败：两个种子化 fuzz 现在会在扫描过程*进行中*报告深度，因为循环结束后的截断日志恰好在它唯一要解释的事件上无法触发（宿主要超时上限杀掉测试时，只会打印 `Test timed out`）。预算与超时上限的调整被刻意推迟，等心跳数据说明是哪一种原因。
- 本次发布的账目变化：`data-bus.ts` 未覆盖分支臂 17 → 13、未覆盖函数 3 → 2；其中三条被重新归类为“由调用点支配”而非再去凑测试，另有一次构造尝试经测量证伪后回退。全量分支覆盖率 96.41 → 96.63，共 876 个测试。

## 0.21.4 已完成范围

- 修掉的是一个真实缺陷，而不是覆盖率数字：失败记录用 `String(error)` 渲染拒绝原因，而这个转换并不是全覆盖的——`Object.create(null)` 根本没有原始值转换，而 `DataBusTransport` 是由应用实现的公开端口，可以用任意值 reject。于是"报告一次失败"会制造出第二次失败；`getRecoveryStats()` 里也有同样的裸转换，所以最后一场失败无法字符串化的总线，其 `getHealthSummary()` 会直接抛异常——本该解释故障的探针在故障期间拒绝回答。
- 可观察的那一条：open 失败、其清理又同时失败之后的重试，永远不会重新打开传输。因为 `createStopPromise()` 以 `.catch(error => this.reportError(error))` 收尾，这个 handler 自己抛了，于是 `pendingStop` 变成 reject，`start()` 串在它后面的 `.then()`（正是 `0.21.3` 删掉吞除分支的那一处）被跳过，`transport.start()` 再也没被调用，调用方只拿到 `TypeError: Cannot convert object to primitive value`——一句关于格式化器上限的话，而不是关于他的传输。`describeFailure()` 让记录器变成全覆盖，而这正是那条链式 await 一直需要的性质。
- 这同时补回了 `0.21.2` 与 `0.21.3` 立论所依赖的那一步。两次删除吞除分支所依据的 `pendingStop` 赋值点枚举是对的；但"以 `.catch(error => this.reportError(error))` 收尾，因此一定 resolve"这个结论，悄悄假设了 `reportError` 不会抛。两处注释现在明确写出这层依赖，并有一个测试端到端驱动"两次都失败的 open"链条，于是那两次删除依据的是验证过的事实而非假设。
- 同样的缺陷形状在配置校验里也被修掉（`assertPositiveSafeInteger`、`assertPruneStrategy`、`assertHeartbeatInterval`）：对调用方传入的值做 `String(value)`，使一条本应说明配置项写错的告警，变成格式化器抛出的 `TypeError`；而在 `assertPruneStrategy` 里，这个转换本身就是枚举值成员判定。
- 顺带得到一条测试经验：无论校验器是在拒绝这个选项，还是在拼接消息时报错，`toThrow(TypeError)` 都会通过，所以新增断言钉的是消息文本；并且因为 `stopShouldFail` 只能以真实 `Error` 失败，`FakeTransport` 增加了 `stopRejection` 来指定 reject 的**原因**。

## 0.21.3 已完成范围

- 再从 `CrossTabDataBus` 删掉两个永远不会触发的拒绝吞除分支，证明方式都是枚举被吞 promise 的赋值点：`stopPromise` 只有一个非空赋值（`stop()` 手工 resolve 的门，两个 settle 分支都会 resolve 它——这正是公开的 `stop()` 不会拒绝的原因），而每个非空 `pendingStop` 链都以终止性的 `.catch(error => this.reportError(error))` 收尾。`data-bus.ts` 函数覆盖率由 115/120 变为 115/118，且没有删除任何测试。
- 该模块的未覆盖处理函数现在只剩三个，且各自带有写明理由：一个是刻意保留的兜底（防止 `performStop()` 出现未处理拒绝），其余的还欠一次调用点枚举，才能判定为被支配或补上断言。

## 0.21.2 已完成范围

- 删掉一个死的吞异常分支，而不是让它永远作为"未覆盖函数"留在账上：`performStop()` 用 `.catch(() => undefined)` 等待待完成的传输停止，而证明这条臂跑不到的依据，就是 `pendingStop` 仅有的两个非空赋值点——每个链条都以终止性的 `.catch(error => this.reportError(error))` 收尾。它上面那行对 `startPromise` 的吞除则保留，因为那个 promise 确实会拒绝：它是失败的 `ready()` 交给调用方的那次 open。
- 两个判断以及得出判断的方法，都写在了下一位读者会看的地方：源码注释，以及与既有"同步 catch 守卫"规则并列的 `AGENTS.md` 约定。整体覆盖率由 98.68 / 96.16 / 98.54 / 99.45 变为 98.71 / 96.16 / 98.72 / 99.45，没有删除任何测试、没有调低任何上限、也没有任何行为变化。

## 0.21.1 已完成范围

- 库行为没有任何变化；本次发布的增量全在示例、测试与文档面。`pnpm build:examples` 从本地安装打包 `react` + `react-dom/client`，产出被 git 忽略的 vendor 模块，取代原先让 `examples/react` 在无网络 CI 上根本加载不出来的 `esm.sh` 引用——并且那个页面跑的是 React 18，而适配层测试跑的是 19。
- 现在同一组四个浏览器用例驱动两个示例页（扇出、响应式换 topic 后旧 channel 在服务端订阅数归零、owner 标签关闭后仍能送达、清空 topic 输入框后的回退），因为 React 页补齐了 Vue 页早已具备的 id、`?topic=` 覆盖与 `__reactBus` 诊断钩子。只命中某一个页面的失败因此能定位到适配层而不是库，而且回退那条断言在两个页面上都经过变异验证。
- `docs/getting-started.md`（中英双语）写清了浏览器套件到底覆盖哪些页面；`0.21.0` 发布说明里提到的 `cross-tab-worker-databus/react` 导出其实并不存在（真实子路径是 `cross-tab-worker-databus/hooks`），已发布的文本不会被改写，因此在 `Unreleased` 中更正。

## 0.21.0 已完成范围

- 项目第一个弃用周期正式结束：`subscribe("")`、`publish("")`、`publishBatch("")` 由 `0.20.96` 的每实例告警一次改为抛出 `TypeError`。守卫与选项校验断言放在一起，且先于其他任何副作用执行，因此被拒绝的调用不会请求 start、不会登记 handler，也不会写入路由记录——`publishBatch("", [])` 同样先于文档承诺的"空数组 no-op"被拒绝。
- 这条边界由两个用例而不是一个撑起：空数组用例的存在，是因为其他任何空 topic 批量调用都会经由单条目委托被 `publish()` 拒掉，所以放在 no-op 之后的守卫会静默返回且无人察觉；每条报错都使用调用方实际使用的方法名，原因也是这个。
- React 与 Vue 示例页获得 demo 页早就有的 topic 回退，而两个新的浏览器用例先记录了"没有回退会发生什么"——`TypeError: CrossTabDataBus.subscribe("")` 以 `pageerror` 冒出来，同时 Vue 标签页仍在渲染它上一个 topic；demo 页则落到 错误 并留下一条事件流错误行。`||` 与 `??`、有无 `trim()` 各被不同的断言臂杀掉，均经变异验证。
- `docs/getting-started.md`（中英双语）不再夸大浏览器测试的覆盖面：只有 Vue 适配页会在真实浏览器里被驱动，因为 React 页的 React 本身来自 `esm.sh`，在没有网络的 CI 里根本加载不起来。该页的 topic 回退因此是本次变更唯一靠手工验证、而非靠门禁覆盖的路径。
- 覆盖率上限保持不变且仍然达标（98.68 / 96.16 / 98.54 / 99.45，对应下限 96 / 92 / 96 / 97）；这个版本向 `pnpm check` 增加一个单元用例，向浏览器作业增加两个用例。

## 0.20.97 已完成范围

- 公开接口与可观察的运行时行为均未改变。发布的 `src/` 变更只涉及 `centrifuge.ts`：删除两处不可达的 `typeof Worker` / `typeof SharedWorker` 抛错，并以注释记录为何一个守卫被保留、另一个被移除。其余全部是示例、测试、CI 与文档工作。
- Vue 适配层终于运行在它真正交付的环境里：`examples/vue/` 用本地安装的 `vue` 包（不依赖 CDN）挂载真实的 `cross-tab-worker-databus/vue` 组合式 API 并连上本地 demo 端点，`e2e/adapters.spec.ts` 在真实 Chromium 标签页中驱动它——两个标签互收消息、响应式切换 topic 后服务端释放旧 channel、owner 标签关闭后仍能送达。在此之前 Vue 入口从未在 jsdom 之外执行过。
- 跨 tab 之间的核心契约由手工排列变成随机模糊：三个 bus 共享一套存储注册表与 BroadcastChannel，随机交织订阅/退订/发布/隐藏/显示/停止/启动/心跳/丢弃帧/伪造 `SUBSCRIBE`，在静默态断言每个存活 topic 恰有一个 owner 与恰一个 transport 持有者、已离开的 topic 不留残留、一次发布对每个存活订阅者恰好扇出一次。五个变异体能杀死这些断言；三个守卫存活，因为 `reconcileAssignedTopics()` 会修复它们——这一点被记录下来，也正是它们属于帧级回归的原因。
- 两个发布门禁的计时失败被追到根因而非重试了事。协调模糊测试的 `Date.now()` 预算读的是本套件自己伪造的时钟——复用 worker 里残留的假 `Date` 让同一个文件一次在 16.4 秒停在下限、另一次在 CI 上烧掉 539 秒——因此 `tests/setup.ts` 现在在每个测试后恢复真实计时器，模糊测试改用 `performance.now()` 计预算。热路径性能门禁移入独立的顺序步骤，因为绝对毫秒上限只有在未被调度的核上才度量代码。
- 一次凭证守卫的调查结果恰是"守卫留下"：一个以不可达为由删除它的 PR 被证明是可达的——入口代码（`getToken()`）可以在抛错前先 `stop()` 传输——于是它获得了经变异验证的回归用例，而区分"可达"与"确实被上层支配"的规则写进了 `AGENTS.md` 与源码。
- 仅 CommonJS 才有的默认 Worker 失败由构建产物钉住：`dist/cjs` 无法经 esbuild 的 `import.meta` 垫片解析 Worker URL，因此 `start()` 必须给出可操作的 "provide workerFactory explicitly" 而非 `TypeError: Invalid URL`；两个工厂函数都被断言，且同一用例同时检查 ESM 产物，从而把失败绑定到模块格式而不是文件名。
- 全量覆盖率从 98.62 / 96.02 / 98.54 / 99.38 提升到 98.68 / 96.17 / 98.54 / 99.46，且未下调任何阈值；`docs/transports.md`（中英）记录了"自带字符串 `topic` 的发布会被重新寻址到该 topic"这一规则——它既是通配符投递指明具体 topic 的方式，也是 `{ "topic": … }` 载荷可能无声丢失的原因。

## 0.20.96 已完成范围

- 开启项目第一个弃用周期：空 topic（`""`）现在会在 `subscribe()`、`publish()`、`publishBatch()` 中每个 bus 实例告警一次，而不再静默登记一个没有任何 transport 能寻址的 channel。行为保持不变；按 pre-1.0 策略，后续小版本会在该边界直接拒绝——`0.21.0` 已完成这一步。契约已写入 API 参考与升级指南（中英双语）。
- 用证明取代假设，清空覆盖率分支台账：十一个"测试根本不可能失败"的行为获得经变异验证的回归用例——离开方 owner 删除无人订阅路由而非交接给存活 peer、最后一个远端订阅者离开时 owner 释放自身 transport 订阅、被取消的持久化清扫保持静默、被取代的水合快照被丢弃而非合并、默认平台 `WebSocket` 构造（含子协议）、恢复预算耗尽后 `ready()` 交出真实传输错误、Vue 适配层吞掉被拒绝的 `ready()`、把 `connectTimeoutMs` 设为 0 或 Infinity 时确实无限等待、私有 topic 在其唯一持有者隐藏时不留路由记录、在没有 `console.warn` 的运行时吞掉抛错的 trace sink，以及无关的已持有通配符 pattern 无法截获发往远端 topic 的批量消息。
- `src` 中其余零计数分支已全部归类：被支配、按构造不可达，或属于缺失的边界校验（正是它引出了上面的弃用项）。`vue.ts` 与 `hooks.ts` 四项指标均达 100%，`cluster.ts` 只剩一行未覆盖。
- `AGENTS.md` 记下让早期草稿变成装饰性测试的陷阱：共享 `ChannelHub` 的 peer 会自愈被观测的状态、缺少一次 microtask flush 的 peer 对其他 Tab 不可见、文本重复的守卫会让非全局替换改到错的那一份。
- `typescript-eslint` 升级到 `8.70.1`；在 lint 工具链的 peer 范围仍排除 7.x 期间，TypeScript 保持 `6.0.3`。

## 0.20.95 已完成范围

- 删掉只用来抬高覆盖率的不可达防御分支：存储写入器"重试已排程"守卫、两处有界映射淘汰循环里的 `undefined` 判断，以及 Centrifuge 传输层的三个 Worker/port generation 检查——后者即使可达也无法分辨是哪个 Worker 报的错。
- 移除 React 适配层的 lifecycle generation ref（React 的 effect 顺序永远不会走到它的任一分支），并修正配置文档中描述该机制的说法。Vue 适配层的守卫确实起作用（其函数体会 await 一次 stop），保持不变。
- 堵上 Vitest 断言漏洞：`rejects.toThrow('message')` 在 reject 原因为 `null` 或 `undefined` 时同样通过，这使 IndexedDB 回放测试里所有 `reason ?? new Error(...)` 兜底消息断言形同虚设。新增 `expectRejectionMessage()` 同时校验 Error 实例与消息，并把该约定写入 `AGENTS.md`。
- 再有六个行为获得经变异验证的回归用例：存储事件通道的畸形载荷守卫、入门指南中描述的无 BroadcastChannel 回退接线、存储写入器的键枚举、去重清扫的过期保留、迟到的凭据失败路径，以及 React hook 在依赖变化后交出最新 bus。`environment.ts`、`storage-batch.ts`、`dedup-manager.ts`、`hooks.ts` 四项指标均已达 100%。

## 0.20.94 已完成范围

- 修复 Vue 订阅 composable 对自身 `handler` 参数注册的永久空转 watcher，并钉住同一目标重绑守卫：bus 与 topic 在同一 tick 变化时不再拆掉刚建立的订阅再重建。
- CI 单元门禁不再被 runner 负载拖垮：为反复拉起子进程的 package/compat 门禁设 15s 上限，为已在覆盖率插桩下逼近自身 30s 预算的生命周期压测器保留显式 120s 预算。
- 覆盖率下限从"装饰性"改为真正生效：此前下限 85/80/90/85 与实测 98.13/94.59/98.17/99.19 相差十余个点，现为 96/92/96/97。
- 为九个此前没有有效测试的行为补上经变异验证的回归用例，其中包括一条在删掉淘汰循环后仍能通过的路由 owner 缓存断言、下一次 `start()` 的重水合、远端批量解包中无 metadata 的条目，以及被替换 client 的状态隔离。

## 0.20.93 已完成范围

- 强化 package 元数据、无条件与 fallback array target、递归嵌套及自定义 export condition 的兼容性门禁。
- storage 能力探测必须完成可读的写入-读取-删除往返；channel 构造失败时安全降级；sessionStorage 不可用时保持稳定的内存 tab identity。
- 在 clear 与 cluster teardown 时取消失败的 storage retry，并用 cluster 级 restart 回归覆盖收敛行为。
- 更新 patch 级开发依赖，完成发布、浏览器、打包、兼容性与安全全量门禁。

## 0.20.92 冻结范围

当前开发线继续验证 predecessor reopen 结算、排队启动就绪与 stop promise 清理等生命周期错误路径。该开发线现已落地十六处修复。第一处让共享 stop gate 先于同步 teardown 前奏安装：从同步 STOP lifecycle trace 事件重入的 `stop()` 会共享同一次 teardown，而不是再调用一次 `transport.stop()`。第二处在 START trace 发出前安装 lifecycle epoch 与 `startPromise`：若同步 trace/status 回调重入 `stop()`，外层 `start()` 会立即停止后续 timer、cluster 与 topic 启动，旧 opening 由 epoch guard 放弃，transport 不会被重新打开。第三处把相同的「先安装 lifecycle、再发同步回调」顺序应用到 `reopenTransport()` 的 CONNECTING 状态通知，使恢复期间重入的 stop 能取消本次 reopen，而不是在 teardown 后重新打开 transport。第四处让同步 RESUME trace 回调内的 stop 同时取消显式 `start()` 与原生 `pageshow` 恢复；`WorkerClusterRuntime` 通过 lifecycle generation 阻止外层 pageshow 在 `onResume` 已停止或暂停 cluster 后再次 `activate()`。此前这些场景都可能留下 `state: stopped` 但 transport 或 cluster 仍活跃的半停止状态。第五处让已经停靠在 recovery gate 上的 transport 操作不再因等待中的自动恢复尝试失败而滞留：`runTransport()` 现在统计停靠操作数，自动尝试失败时若仍有 waiter 会立即发起一次 on-demand reopen，使在 cooldown 期间发出的 `publish()` / `subscribe()` 自身即可驱动恢复，而不必等待之后某个无关操作。demand reopen 自身失败时仍会重新武装 flag 留待后续操作重试，而不会在自身失败上自循环；一旦 reopen 成功，全部 waiter 会按序 flush。cluster-key 隔离保证现在由双 runtime 回归固定：不同租户可独立拥有同一 topic、publication 不会跨命名空间边界、持久化 key 使用不同 opaque hash 且不暴露明文 key。第六处 replay retention 修复会在 suspend/resume 期间旧 cleanup 事务仍在收尾时，把新排队的最新 cutoff 交给新一轮 cleanup，避免它一直滞留到未来某个无关 publication 才被处理。第七处在 `reopenTransport()` 发出同步 CONNECTING 通知前清空 `transportReady`，避免同一 tick 内第二个操作把仍在关闭的旧 transport 误判为可用连接；所有操作都会继续停靠在 opening 上，并在 replacement 打开后按序 flush。第八处让 pagehide suspension 续体具备 epoch 感知：若同步 DISCONNECTED status 回调按公开恢复路径调用 `start()`，旧 hide 续体会被放弃，不会在 replacement 打开后再次停止 transport 并留下错误的 healthy 状态。第九处修复保留 durable hydration 与实时流量的回放顺序：若 `load()` 尚未完成时已有 publication 写入，加载快照会排在实时消息之前，数量裁剪因此保留最新的实时消息，而不会把旧历史误认为更新内容。第十处让 replay hydration 能跨 lifecycle 替换：清除全部、清除单 topic、退订与 cutoff 裁剪会应用到仍在进行的加载快照，避免已清除历史复活；suspend/restart 会取消被取代的 load 并启动新一代 hydration；显式 stop/start 后也会重新加载 durable history，而不是留下空 ring。第十一处补上严格交接的 generation 缺口：`ROUTE_RELEASED` 必须与存储 route 的 generation 精确相等，其他交接轮次的 ACK 不能确认当前 route，也不能提前释放其 `SUBSCRIBE`。第十二处修复排队重启与 BFCache 的竞态：`WorkerClusterRuntime.start()` 会先安装 lifecycle listener 再检查可见性，因此排队在异步 stop 之后的重启能观察到清理期间到达的 `pagehide`，保持挂起并等待 `pageshow`，而不会重新连接隐藏页面。
第十三处把每个入站 `CONTROL/SUBSCRIBE` 绑定到持久化 route：较早分配轮的迟到帧不能再让非 owner 订阅 transport，也不能在匹配的 `ROUTE_RELEASED` 之前确认悬挂交接；同一 route 的合法订阅与正常交接 ACK 保持不变。
第十四处修复 recovery gate 取消竞态：当 pagehide/stop 取代恢复周期时，已停靠在门上的操作会失效；紧随其后的显式 `start()` 可以在 replacement transport 上重建订阅，而旧 waiter 不能再于重启后重放并与该过程竞争出重复订阅。
第十五处修复显式 `start()` 取代自动恢复 timer 时停靠操作被静默丢弃的问题：取消 timer 不再释放 recovery gate；若该显式重开也失败，停靠操作会保留到下一次自动或按需恢复成功后再回放。
第十六处修复让被拒绝的 teardown 同时保留在两个失败账本中：`stop()` 仍会 resolve 并通过 `onError` 上报，但 recovery 账本会与统一的 `lastFailure` 记录保持同一次 stop 失败，直到显式 `start()` 同时重置两者。


## 0.20.91 已完成范围

可靠性开发线继续补强错误路径覆盖并维护发布门禁。IndexedDB replay 清理现在覆盖 `clear()`、`clearTopic()`、`clearBefore()` 的事务级错误，包括连接失效后的恢复，以及浏览器未提供 transaction error 对象时的领域级 fallback 拒绝信息。WebSocket transport 也会在连接失活后 best-effort 关闭 socket，避免自动恢复遗留死连接；已发布包验证的正常路径经审计确认没有固定等待或多余 registry 往返。Centrifuge token bridge provider 现在绑定到创建它的 client lifecycle，已被替换的 client 无法把迟到凭证请求送入新会话。旧 client 的 subscription 回调与 publish rejection 也已有回归约束，不能修改或上报到替代会话。
DataBus 生命周期审计现在还固定了 failed-reopen 的 stop gate 复用、被取代 initial open 的迟到 rejection 隔离、已退休 transport 迟到的 message/status/error 回调 generation 隔离，以及就绪/恢复契约（`stop()` 后迟到的 `pageshow` 不得重启后台工作、自动恢复再次失败必须通过 `ready()` 暴露、被取消的排队启动不得满足替代重启、排队重启在可用前被挂起必须让 `ready()` reject、旧 recovery timer 不得重开 transport）。本轮审计还发现并修复了一处真实定时器泄漏：`WorkerClusterRuntime.pause()` 在无 channel 时不再排定延迟 `channel.close()`。mutation check 已确认移除对应守卫时每条回归都会失败。本阶段还覆盖 failed-open 后 stop gate 复用、pagehide stop rejection 恢复、replay handler 分发隔离，以及 in-flight recovery reopen 复用；重开守卫已有 mutation 覆盖。

排队 transport 操作审计还固定了：在 initial open 尚未完成时排队的 `subscribe()`，其 rejection 必须恰好通过 `onError` 上报一次且不得成为 unhandled rejection；start gate 放行前不得触碰仍在 opening 的 transport。
DataBus 生命周期审计还固定了 initial `transport.start()` 被 `stop()` 取代后、teardown 等待期间才 reject 的 rejection ownership：原 `start()` 调用方看到自己的失败，`stop()` 仍成功，transport 恰好关闭一次，旧失败不会进入新 lifecycle 的 error ledger。
跨 Tab `EVENT` 边界现在会拒绝不是对象、或缺少字符串 `topic` 的 publication payload，因此一条畸形的同源帧不会再从 BroadcastChannel 监听器抛出并破坏后续投递。未知事件类型保持前向兼容；旧版 payload 会继承帧级 `originTabId`，payload 自带归属优先，两项行为均有回归固定。

## 0.20.90 已完成范围

本开发线修复 0.20.89 tag 首发暴露的发布管线问题，并统一文档中的投递语义。

- 发布门禁传播预算：阻塞式已发布包消费者验证从 24 × 5 s（2 分钟）提升为 48 × 7.5 s（6 分钟）。0.20.89 的 tag 首发发布成功之后仍在该门禁失败，因为 `npm pack` 在旧预算内始终返回 `ETARGET`；真正缺失的包仍会耗尽预算而失败。
- 投递语义：API、架构与能力文档现在一致说明有界的本地 fan-out 保证，并明确 SDK 不提供端到端的 at-least-once 或 exactly-once 投递；中文 API 参考已补充按 bus 可选启用的 `messageId` 去重窗口。
- 发布性能证据：基准趋势文档已基于 23 份归档报告刷新；最近两次运行对比未超过 50% 上限，两种 Worker 模式的单消息发布延迟均有改善。

## 0.20.89 已完成范围

本开发线延续异步回调隔离审计：以下每一项修复都把回调、排队微任务或 Promise 续体绑定到创建它的生命周期 generation，使被取代的会话无法写入其替代者。

- 异步 teardown 与重启边界：已 settle 的 `stop()` gate 不再吞掉后续 teardown（`stop → start → stop` 现在以停止态结束）；`getHealthSummary()` 对正在停止的 bus 报告 `state: 'stopped'`，不再与其已经发出的 `publish()` / `subscribe()` / `ready()` 拒绝语义自相矛盾。
- replay 持久化隔离：微任务排队的 batch flush 与被排队的 retention cleanup 会在 `suspend()` / `stop()` 取代其 generation 后被丢弃，已停止会话的历史无法再写入 durable store。
- durable hydration 取消：在 `suspend()` 或 `stop()` 之后才 resolve 的 `load()` 不再向 teardown 已清空的缓冲区追加数据，并按生命周期取消上报，而不是记为持久化失败。
- trace 会话隔离：已停止的 trace reporter 保持惰性——旧会话排队中的 `asyncSink` 事件被丢弃，显式重启会清除停止标记，使其重新发出生命周期 `start`。
- transport 与 Worker 回调隔离：Centrifuge credential-provider 结果绑定到发起请求的确切 Worker/port/session；`CentrifugeSession` 的异步 client/subscription 回调在 `STOP` 或重新初始化后被忽略；来自已替换 WebSocket 连接的 `Blob` 二进制帧不再被当作新连接的帧派发。
- 回归安全网：seeded lifecycle fuzzer 现在覆盖 1_500 种交织，并断言最后一次显式意图为 `stop()` 的序列会以 `state: 'stopped'` 且无 live transport 结束。

## 0.20.88 已完成范围

- 启动失败恢复现在可重入：transport 在初始 `openTransport()` 尚未结算时同步上报 `error`，调用方可以从 `onStatus('error')` 或 `onError` 回调立即重试。失败 open 会先完成清理，重试建立新的生命周期，旧 rejection 不会重新污染已重置的失败账本。
- 初始 transport open 尚在飞行时反复发生 BFCache `pagehide`/`pageshow`，不再让 bus 永久停留在挂起状态。suspend 只在旧 stop gate 仍代表当前生命周期时复用；否则安装新的串行 stop，使下一次 resume 真正重开 transport。
- 显式 `start()` 现在是完整的 BFCache 恢复路径：除 transport 外还会恢复跨 Tab 协调，并重新启动 `pagehide` 暂停的 trace metrics、dedup 过期清扫与 replay retention 定时工作。

## 0.20.87 已完成范围

- transport 恢复与就绪加固：原生 WebSocket 后端现在遵守 `DataBusTransport.start()` 契约（仅在 `open` 后 resolve，握手失败或超过 `connectTimeoutMs` 时 reject），自动恢复会真正创建替代 socket，`getHealthSummary()` 跟随 live transport 状态而不是 `transportReady` 诊断标记。
- 不再把操作写进已经消失的连接：恢复门会把 `subscribe()` / `publish()` 停放在自动与按需重开之后（包括自动尝试失败但仍保留预算的情况）；在真实连接之后出现的干净 `disconnected` 现在会触发一次按需重开，而不是交给已关闭的 socket；而异步上报连接状态的 worker 型后端仍保有其「尚未连接」窗口，不会被动重开。
- 生命周期与 `ready()` 边界修复：BFCache 挂起期间 `ready()` 会 reject；transport 自身 `stop()` reject 或抛错时 `stop()` 仍能 resolve；一次打开失败在两个恢复账本中只打一次时间戳；运行期 transport 错误会进入恢复账本；被取代的异步打开不再拆除更新的 suspend/resume 转换。
- 适配器与工具链：React/Vue `useCrossTabHealth` 在 `intervalMs` 变化时无需重建 bus 即可生效；`vitest` 及其 coverage-v8 provider 升级到 5.0.1 补丁版。

## 0.20.86 已完成范围

- 加固显式 stop/start 边界的生命周期：排队重启与进行中的 stop 串行化，并会被更新的 stop 取消，可通过 `ready()` 观测；被取代的异步开启不再拆除更新的 suspend/resume 转换；stop 期间调用的 `subscribe()` 与非空 `publish()`/`publishBatch()` 改为通过 `onError` 上报，不再修改 teardown 状态或被静默丢弃。
- 显式 `start()` 在自动恢复预算耗尽后，现在会执行文档所述的手动恢复，同时保留 cluster 状态、订阅与回放历史。
- IndexedDB replay 持久化在事务 abort（包括连接丢失导致的 abort）时结算全部 mutation，串行队列不再永久阻塞；replay AGE 裁剪改为内存与持久化历史共用同一套位置无关策略。
- 配置参考在中英文中完整记录 replay/dedup 公共选项，并新增从声明派生的文档守卫；固定种子属性不变量覆盖 active-worker 选择与 rebalance target。

## 0.20.85 已完成范围

- 新增固定种子的属性测试套件（`tests/property.test.ts`）：针对纯热路径函数与有状态管理器，覆盖有限性/全函数性、与顺序无关的选择、循环安全的大小估算、publication topic/元数据有效性、`serializeError` 可克隆性，以及长时间随机操作序列下的 dedup/replay 上界。
- `effectiveWorkerLoad` 对损坏的存储基础负载保持全函数性——非有限值（JSON `1e999` → `Infinity`）不再泄漏进 owner 选择并重新引入数组顺序依赖。
- `approximatePayloadBytes` 增加深度上界，循环 payload（structured clone 会保留循环）不再使回放字节占用或自适应负载采样栈溢出。
- `serializeError` 始终产出可结构化克隆的结果；不可克隆的 context（函数/Symbol）会被丢弃，而不是让错误上报本身抛出 `DataCloneError`。
- 当 `pruneStrategy: 'age'` 未配置 `retentionMs` 时，回放历史重新受上界约束：内存环与 IndexedDB 记录均应用数量上限。

## 0.20.84 已完成范围

- 发布/CI 门禁由“文档约定”变为强制执行：`pnpm test:coverage`、`pnpm verify:compat`、`pnpm verify:pack` 进入 CI verify job，Release 工作流在发布前重跑 lint + compat + pack，两个 checkout 均拉取完整历史与 tag 以便解析 compat 基线。
- 协调恢复加固：交接 ACK 丢失、owner 崩溃或前任 owner 退出后，均由 worker-TTL 门禁的重新选举恢复，采用单写者与投影负载分摊；每次路由确认 / 迁移 / 恢复都会发出有界的 `reliability` trace 事件。
- 三个真实正确性修复：Vue `useCrossTabDataBus` 卸载泄漏（pending start 可能创建无人拥有的 bus）、自适应 dedup TTL 未在热路径生效，以及 `effectiveWorkerLoad` 会把损坏的存储 load 造成的非有限评分泄漏回 owner 选择。
- 产品 demo 可观测性：事件流渲染 reliability / subscription / coordination trace 事件，混沌开关在真实浏览器中演练丢 ACK 与崩溃恢复路径，配置面板显示当前混沌模式。
- 覆盖与工具链：`ReplayManager` / `DedupManager` 直接测试套件、transport 错误隔离与部分元数据覆盖、vitest 5（基准 API 已迁移）与 eslint 10 lint 配置；TypeScript 7 因 typescript-eslint 未支持而继续递延。

## 0.20.83 已完成范围

- 健康钩子的适配器边界用例、可归档对比的浏览器基准、与当前能力对齐的 README 特性清单。
- 一次大规模内部清理：全部运行时字符串字面量集中到 `utils/constants.ts` 并由之派生字面量类型，回放与去重从 `CrossTabDataBus` 拆分为自包含的 `ReplayManager` / `DedupManager`。
- demo 的「批量 10」publishBatch 按钮与 `/debug/wsstats` 帧计数及单帧 E2E，`asyncSink: true` 投递语义文档，以及与阻塞式发布消费者校验对齐的发布检查清单。

## 0.20.82 已完成范围

- E2E 默认断言上限提升至 20 秒；结构化克隆拒收（Symbol）与 cause 保留覆盖；共享模式会话生命周期经示例服务的连接数端点端到端验证。

## 0.20.81 已完成范围

- 浏览器基准新增 data-bus 热路径矩阵，健康摘要纳入 E2E 端到端断言，storage-event 通道与传输层批量进入 API 文档与能力矩阵。

## 0.20.80 已完成范围

- E2E 可靠性治理：失败 trace/视频与更长保留期、reload 类用例的先收敛后发布模式、符合文档保证的错峰突发模式，以及架构文档中的丢失与恢复矩阵。

## 0.20.79 已完成范围

- 已发布包消费自检成为 release 阻塞门禁（重试预算提升至 24 × 5 秒）；丢失 ACK 交接的恢复链（TTL 清理 + 恢复后重选举）由回归固化。

## 0.20.78 已完成范围

- E2E 逐 Tab 断言真实 transport 后端；延迟关闭不变量由回归测试固化并写入架构文档；getting-started 覆盖健康摘要与协调降级。

## 0.20.77 已完成范围

- 修复无 factory 时静默降级本地会话的缺陷（打包的 Worker 现在真正被使用）；补充默认后端与通道丢失恢复覆盖；demo 展示协调通道诊断与降级开关。

## 0.20.76 已完成范围

- 面向无 BroadcastChannel 环境的 opt-in storage-event 协调降级通道，含降级通道上的 owner 选举集成测试，并同步降级文档与能力矩阵。

## 0.20.75 已完成范围

- 单测套件新增热路径性能门禁（宽松阈值防灾难性退化，真实基准仍在 `pnpm bench`）；IndexedDB replay 持久化新增脚本化故障注入，覆盖 invalidate 与恢复错误路径；审计确认 Release workflow 已集成已发布包消费自检。

## 0.20.74 已完成范围

- 可选的 `DataBusTransport.publishBatch`：WebSocket transport 单帧批量发送，demo server 支持批量帧，无批量能力的 transport 自动回退逐条发送；React/Vue 新增 `useCrossTabHealth` 绑定；健康判定纳入 transport 实时状态。

## 0.20.73 已完成范围

- IndexedDB replay 持久化适配器纳入单测（基于 `fake-indexeddb`）：覆盖裁剪策略、批量分组、并发串行化、清理语义与瞬时打开失败恢复。
- 真实浏览器 E2E 新增三 Tab 并发发布突发与整连接重构建（stop/start）重入集群两个场景；architecture 文档新增稳定性不变量参考（中英文）。

## 0.20.72 已完成范围

- 扩展基准矩阵，覆盖 `publishBatch`、wildcard routing、dedup、replay prune、批量持久化与异步 trace sink。
- 长时稳定性加固：补齐 handoff ACK 世代校验、BFCache 往返、恢复耗尽重置、存储写退避恢复与 replay 持久化清理竞态的回归测试；修复反向的 stale-ACK 世代比较与批量 flush 复活清理历史两处缺陷。
- 生产能力：`getHealthSummary()` 就绪判定、`getPersistenceStats()`、diagnostics 中 transport 状态细化（status/suspended），以及构建时注入的 SDK 版本。

## 0.20.71 已完成范围

- 新增可选 `appendBatch` replay 持久化接口；IndexedDB 对发布突发进行事务合并，旧适配器保持兼容。

## 0.20.70 已完成范围

- 在统一 diagnostics 中新增 SDK 版本与 transport/backend 身份，便于支持包与健康面板使用。

## 0.20.69 已完成范围

- 在 cluster snapshot 与 diagnostics 中新增 peer 协议能力发现。当前 runtime 广播协议版本 1；旧 peer 显示为 `null`。

## 0.20.67 已完成范围

- 新增未知协议消息计数与最近类型诊断，并纳入 `getDiagnostics()`，同时保持旧 runtime 安全忽略未知消息。

## 0.20.66 已完成范围

- IndexedDB replay persistence 新增可选 `pruneStrategy` 与 `retentionMs`，与内存 replay 使用一致的裁剪语义。

## 0.20.65 已完成范围

- 新增可选 dedup 自适应 TTL 与 replay `pruneStrategy`（`count`、`age`、`both`），保留旧默认行为。

## 0.20.64 已完成范围

- 新增 trace `asyncSink` 选项，将 sink 投递合并到 microtask，保持事件顺序与错误隔离，并新增回归测试（339 个单测）。

## 0.20.63 已完成范围

- 新增可选 `onUnknownMessage` 钩子；旧 runtime 遇到未来 cluster message variant 时安全忽略，不抛异常，并增加回归测试（338 个单测）。

## 0.20.62 已完成范围

- 新增 `CrossTabDataBus.getDiagnostics()`，整合 status、transportReady、recovery、dedup、replay 用量与 cluster 快照，便于健康检查与运行时观测。

## 0.20.61 已完成范围

- 在每条 `DataBusMessage` 与 cluster `EVENT` 线帧上加入 `originTabId?: string`，让跨 Tab 的 replay 历史能归属到产出的 Tab。
- `WorkerClusterRuntime.broadcastEvent()` 默认把 `originTabId` 设为当前 runtime 的 `tabId`，`CrossTabDataBus.handleTransportMessage` 在广播前 stamp `originTabId = cluster.tabId`，邻居与 IndexedDB 回放的晚加入订阅者都看到一致的归属信息。
- `onEvent` 处理器签名新增第四个 `originTabId?: string` 参数；既有调用点改用 `toMatchObject` 以避免额外参数破坏严格相等。
- 新增 `CrossTabDataBus cross-tab replay consistency contract` 单元测试，覆盖生产端 stamp、本地 handler 一致性、写后晚加入与本地来源回放路径（336 个单测，11 个 e2e 测试）。

## 0.20.60 已完成范围

- 在 `CrossTabDataBus` 与 `WorkerClusterRuntime` 上新增 `publishBatch(topic, items)`，让调用方把多条 item 合并进单次 BroadcastChannel postMessage。每条 item 的 `messageId` / `timestamp` 在传输后保留，dedup / replay / 顺序仍按 item 维度生效；空 batch 为 no-op，单 item batch 直接走 `publish()`。基准用例 `publishBatch / 1000 messages / 10 per call` 为突发路径提供上限参考（332 个单测）。

## 0.20.59 已完成范围

- 扩展 `CrossTabDataBus.getRecoveryStats()`，新增 `generation` 与 `lastSuccessAt`，用于诊断 transport 的完整开启历史。

## 0.20.58 已完成范围

- 把 publish 路径的 route-owner 缓存加上可配置 LRU 上限（默认 256），并在 `WorkerClusterRuntime.getSnapshot()` 上暴露 size/max/hits/misses 诊断信息。
- 修复了一个远程 owner 的 publish 正确性 bug：此前 `wildcardPublishCache` 的 `null` 项会提前 return，导致没有本地 wildcard 订阅的 topic 不再走 route-owner 查找；现在会正确转发到远程 owner。
- 新增 LRU 淘汰、TTL 失效、owner 迁移和远程 owner 命中缓存的单元测试（319 → 321 个单测）。

## 0.20.57 已完成范围

- 新增 warm/cold route-cache publish 基准，便于衡量 owner 路由的性能。

## 0.20.56 已完成范围

- 为 publish 路由引入带 generation 比对的 route-owner 缓存，并在生命周期关闭时清空。

## 0.20.55 已完成范围

- 新增具备生命周期安全失效机制的 wildcard publish 判定缓存；基准结果仍需进一步稳定后再宣称吞吐提升。

## 0.20.53 已完成范围

- 扩展恢复诊断，新增安全且可序列化的 `errorMessage` 摘要。

## 0.20.52 已完成范围

- 扩展 `getRecoveryStats()`，新增 `hasError`，可观测当前仍保留的 transport 错误状态。

## 0.20.51 已完成范围

- 新增公开恢复状态快照 API：`getRecoveryStats()`。

- 新增 owner handoff 后取消订阅覆盖，验证存活 tab 取消后不会重建路由。

- 新增 reconnect 前取消订阅覆盖，验证已移除 topic 不会在恢复后重放。

- 新增多 topic 恢复覆盖，验证 reconnect 后每个 topic 都只恢复一次。

- 新增长时 reconnect flapping 覆盖，验证重放保持有界且无重复。

- 新增重复 worker 能力探测覆盖，验证 auto backend 选择在多次探测中保持确定性。

## 0.20.45 已完成范围

- 新增 WebSocket 多轮 error/restart 覆盖，验证始终只有最新连接保持活跃。

## 0.20.44 已完成范围

- 新增生命周期契约回归，验证旧 WebSocket 的 close/error 回调不会影响重启后的会话。

## 0.20.43 已完成范围

- 新增 WebSocket 多轮 stop/start 清理覆盖，验证订阅集合和旧回调会在连续生命周期切换中清除。

## 0.20.42 已完成范围

- 新增 Dedicated Worker 多轮 stop/start 清理覆盖，验证 STOP 边界会在连续生命周期切换中隔离旧 worker 投递。

## 0.20.41 已完成范围

- 新增 SharedWorker 多轮 stop/start 资源 soak，验证每轮都会释放监听器和 heartbeat 定时器。

## 0.20.40 已完成范围

- 新增 auto worker mode 多轮失败与恢复覆盖，验证持续优先使用 SharedWorker，且旧 port 的消息不会在连续重开后投递到会话。

## 0.20.39 已完成范围

- 新增 Dedicated Worker 多轮失败与恢复覆盖，验证只有最新 worker 可以投递消息。

## 0.20.38 已完成范围

- 新增 SharedWorker 多轮失败与恢复覆盖，验证只有最新 worker port 可以投递消息。

## 0.20.37 已完成范围

- 新增多轮 WebSocket stop/start 替换覆盖，验证多个旧 socket 的迟到回调都不会泄漏到最新会话。

## 0.20.36 已完成范围

- 新增 1,000 条高频 publish burst 回归，验证本地 owner 快路径保持消息顺序且不读取 storage。

## 0.20.35 已完成范围

- 新增 publish 与 receive/dispatch 热路径基准，和 routing、cluster 协调基准一起建立可重复的吞吐基线。

## 0.20.34 已完成范围

- 新增 transport 故障恢复组合回归，覆盖自动重开/重新订阅、replay 历史、重复抑制、持久化 append 边界和晚加入 handler 顺序。

## 0.20.33 已完成范围

- 新增基于 tag 的发布兼容检查，验证公开 exports、ESM/CJS 条件和类型元数据不会被升级移除。

## 0.20.32 已完成范围

- 新增 replay/dedup 组合覆盖：历史 hydration、恢复后实时消息、重复抑制、持久化 append 边界和晚加入 handler 顺序。

## 0.20.31 已完成范围

- WebSocket 在 stop/start 替换连接后按 socket 身份隔离生命周期和消息回调。
- 新增旧连接迟到事件不会进入新会话的回归覆盖。

## 0.20.30 已完成范围

- 将 IndexedDB replay 持久化 E2E 扩展到 BFCache、stop、reload、异步 hydration、有序历史和 replay 标记的连续生命周期组合。

## 0.20.29 已完成范围

- 新增 Dedicated/Shared/auto worker backend 在全部能力组合下的穷举降级矩阵覆盖。

## 0.20.28 已完成范围

- 将打包消费者验证扩展为发布兼容矩阵，覆盖包元数据、ESM/CJS exports、声明文件和全部公开子路径。

## 0.20.27 已完成范围

- 新增真实 Chromium 连续 BFCache/reload/owner handoff soak，验证 reconnect 就绪状态以及多轮生命周期切换中的跨 Tab exactly-once 投递。

## 0.20.26 已完成范围

- 新增 trace 隐私字段、模式隔离、sink 异常、reliability 事件 schema、有界状态和生命周期 metrics 窗口回归覆盖。
- trace reporter 在 stop 后保持静默，必须显式重新 start 才会开启新窗口。

## 0.20.25 已完成范围

- 新增协议兼容性覆盖：旧版与嵌套 WebSocket/Centrifuge publication 帧、未知字段、非法可选元数据和未知 worker 消息。

## 0.20.24 已完成范围

- 新增 replay/dedup 组合长时回归，覆盖 TTL 过期、静默周期 sweep、durable retention 清理、异步 hydration 与定时器停止。

## 0.20.23 已完成范围

- 新增双 Tab BFCache 与 transport error 接管回归，覆盖 owner 接管、返回恢复和无重复消息投递。

## 0.20.22 已完成范围

- 显式 stop/restart 边界会重置恢复尝试与 exhausted 诊断状态，让新会话从干净序列开始。

## 0.20.21 已完成范围

- 同一失败恢复序列中的 exhausted 诊断只发一次，成功重连后会重置。

## 0.20.20 已完成范围

- 自动恢复达到配置的次数上限时会发出 `exhausted` 诊断事件，不再静默停止。

## 0.20.19 已完成范围

- 可通过 `recovery.maxAttempts` 限制自动恢复次数，同时保留显式订阅需求触发恢复的路径。
- 新增次数上限校验与恢复上限序列回归覆盖。

## 0.20.18 已完成范围

- 自动 transport recovery 的冷却时间可通过 `recovery.cooldownMs` 配置。
- 新增配置校验与 fake-timer 边界回归覆盖。

## 0.20.17 已完成范围

- 连续 transport recovery 诊断现在带有单调递增的尝试编号，成功重连后会重置序列。
- 新增多次失败恢复序列的回归覆盖。

## 0.20.16 已完成范围

- transport recovery trace 现在区分 `scheduled`、`succeeded`、`failed` 结果，便于诊断重连失败。
- 新增失败恢复后成功重试的回归覆盖。

## 0.20.15 已完成范围

- 新增 transport 状态抖动覆盖，验证重复 `connected`/`disconnected`/`error` 通知不会造成订阅重复或丢失。

## 0.20.14 已完成范围

- Release 仅在发布后消费者诊断失败时保留明确 summary，不再阻断已经成功的发布；本地验证仍保持严格失败。

## 0.20.13 已完成范围

- 浏览器 CI 失败时自动保留 Playwright report 和 test-results artifact，便于事后定位 runner flaky 问题。

## 0.20.12 已完成范围

- 发布消费者验证在 CI import 失败时输出包目录和 peer 依赖链接诊断，便于定位仅在 runner 出现的问题。

## 0.20.11 已完成范围

- Release 按 tag 串行执行，并始终把 npm 版本、tag 和 commit 写入 GitHub step summary，便于定位 registry 或 workflow 失败。

## 0.20.10 已完成范围

- 新增多 topic 重复 reconnect 回归覆盖，确保恢复期间每个已分配 topic 恰好重放一次，避免 transport 订阅重复或丢失。

## 0.20.9 已完成范围

- 发布包验证同时接受 semver 和带 `v` 的 tag 输入，确保 release 触发检查与本地命令一致。

## 0.20.8 已完成范围

- 发布后验证会在 npm registry 传播期间轮询 tarball，降低刚发布时的误报失败。
- GitHub Release 在发布或跳过发布后，都会验证当前 tag 对应版本的 ESM/CJS 消费者；手动 npm 发布也适用。

## 0.20.7 已完成范围

- 新增 `pnpm verify:published`：从 npm 下载已发布包，并在干净临时消费者中验证主入口、hooks、Vue、Centrifuge 的 ESM/CJS 导入。
- 支持通过 `PUBLISHED_VERSION` 指定版本；未指定时跟随 npm 当前版本。

## 0.20.6 已完成范围

- 新增中英文发布检查清单，覆盖本地验证、打包消费者、打 tag、手动 npm 发布和发布后验证。
- 明确 npm 历史版本不可覆盖；缺失的历史版本必须从对应 git tag 重建。

## 0.20.5 已完成范围

- 新增公开消费者冻结覆盖：主入口、hooks、Vue、Centrifuge 子路径的 ESM 与 CommonJS 双格式消费。
- 校验发布包中的声明文件存在，并包含 replay、dedup 和 publication metadata 等关键类型。

## 0.20.4 已完成范围

- 新增真实 Chromium 多 Tab soak 场景，覆盖重复 fan-out、owner migration、BFCache 往返、reload 恢复和无重复投递。
- 将浏览器生命周期转换串成一个连续会话，能够捕获孤立用例难以发现的 timer 与 route 清理回归。

## 0.20.3 已完成范围

- 新增 React 动态 topic 生命周期覆盖。
- 验证 topic 替换会移除旧订阅后再接收新 topic，且通过 WebSocket hook 链路生效。

## 0.20.2 已完成范围

- 新增协议恢复回归：malformed binary/text frame 之后，合法 WebSocket publication 仍可继续投递。
- 将二进制截断、JSON 解析失败、nested envelope 和错误隔离串成一个兼容性序列验证。

## 0.20.1 已完成范围

- 新增 persistence mutation sequence soak 覆盖：hydration、重试恢复、topic 清理、后续 append 和全量清理。
- 验证串行 persistence 操作在瞬时失败后仍可继续使用。

## 0.20.0 已完成范围

- publication envelope 兼容性已覆盖 legacy、嵌套、fallback topic、原始 payload、metadata 和未知字段帧。
- 缺失或空 topic 会统一拒绝，同时继续支持 transport 提供的 fallback channel。

## 0.19.9 已完成范围

- 新增 dedup 与 replay/persistence 组合回归覆盖。
- 被 dedup 抑制的 publication 不会污染 replay 历史；TTL 到期后同一 message ID 可以再次被接受。

## 0.19.8 已完成范围

- IndexedDB replay adapter 在事务或请求失败后会使缓存连接失效。
- 已关闭或不可用的连接可沿用现有 persistence retry 路径恢复，不需要重建 adapter。

## 0.19.7 已完成范围

- IndexedDB replay adapter 在 open 失败后会丢弃 rejected promise，下一次操作可重新打开并恢复。
- 与既有跨 tab `versionchange` 连接重置行为保持兼容。

## 0.19.6 已完成范围

- IndexedDB replay adapter 遇到跨 tab `versionchange` 时会关闭旧连接，并在下一次操作时重新打开。
- schema 变化后不会继续复用失效数据库连接。

## 0.19.5 已完成范围

- React bus effect 在 StrictMode 和快速依赖切换下使用 generation 保护。
- 过期的异步清理不会覆盖最新的 active bus。

## 0.19.4 已完成范围

- Vue bus 在快速 reactive 依赖切换时使用 generation 保护重建流程。
- 过期的异步生命周期完成不会重新挂回旧 bus 实例。

## 0.19.3 已完成范围

- 新增可选 `dedup.sweepMs`，在安静期间定时删除过期 message ID。
- sweep 定时器遵循 DataBus 生命周期，默认关闭。

## 0.19.2 已完成范围

- `stop()` 和 pagehide 挂起边界会取消待执行的 persistence retry。
- 已取消的 retry 不会再次调用 adapter，也不会被当作持久化失败上报。

## 0.19.1 已完成范围

- WebSocket 二进制 publication 除 `ArrayBuffer` 外，也支持浏览器常见的 `Blob` 帧。
- Blob 转换失败会通过 transport error callback 隔离报告，不会打崩消息回调。

## 0.19.0 已完成范围

- persistence retry 会发出有界、可选开启的 `persistence_retry` reliability 事件，包含操作名和尝试次数。
- 诊断覆盖 hydration、append、全量/Topic 清理以及 retention 清理，不暴露 payload 或错误正文。
- 保持既有重试时序、默认单次尝试、adapter 契约和最终错误处理兼容。

## 0.18.0 已完成范围

- 新增可选 replay persistence retry，支持有限尝试次数和指数退避。
- append、hydration、手动清理、topic 清理和 retention 清理统一使用恢复路径。
- 导出公开 retry 配置类型，同时保持 persistence adapter 契约兼容。

## 0.17.0 已完成范围

- 新增可选的周期性 replay retention sweep，即使没有新 publication 也能清理 durable history。
- sweep 定时器遵循 start/resume 与 pagehide/stop 生命周期边界。
- 补充 fake-timer 覆盖，保护清理调度、销毁和非法配置行为。

## 0.16.0 已完成范围

- publication burst 期间会合并 retention cleanup，并以最新 cutoff 串行执行持久化 mutation。
- WebSocket binary 协议边界新增截断帧和非法帧回归覆盖。
- 继续保留并明确 legacy replay、JSON metadata 和手动清理的兼容保证。

## 0.15.0 已完成范围

- replay retention 会保留没有显式 timestamp 的 legacy 消息，只清理早于 cutoff 且带显式 timestamp 的记录。
- trace 时间戳支持注入 `trace.now`，与已有的 dedup 时钟注入保持一致。
- 补充 replay 清理、诊断和适配器行为的兼容性与生命周期回归覆盖。

## 0.14.0 已完成范围

- Vue composable 在同一个 bus 上切换 reactive topic 时会正确重绑。
- 跨页面 replay mutation 顺序与生命周期保证已写入文档并有回归测试。

## 0.13.0 已完成范围

- IndexedDB replay mutation 按 adapter 串行化，避免并发 append 的读改写丢历史。
- 完整 stop/restart 边界会清空 dedup 状态。
- 补充持久化失败诊断和生命周期回归覆盖。

## 0.12.0 已完成范围

- dedup TTL 支持可注入时钟，生命周期与过期测试不再依赖墙上时间。
- replay 持久化 append、hydration、退订和 retention 清理失败均有结构化诊断。
- publication metadata 做兼容性归一化：只接受非空 ID 与有限 timestamp。
- 补充 legacy、嵌套、fallback topic 和坏 metadata 协议夹具测试。

## 0.11.0 已完成范围

- 当持久化适配器支持 `clearBefore` 时，通过 `replay.retentionMs` 自动执行持久化回放留存。
- 周期性 trace 指标中加入去重接受/抑制计数。
- 覆盖 WebSocket、Centrifuge、Worker 边界与浏览器 E2E 的 publication metadata 兼容性测试。
- Service Worker transport 决策：在目标浏览器具备稳定的连接生命周期契约前，刻意保持不实现。

## 0.20.68 已交付

- 为集群帧和 worker snapshot 增加协议版本元数据，并保持旧版本缺失字段时的兼容处理。

## 0.20.69 候选

1. ~~增加 peer 能力矩阵，并在 diagnostics 暴露 SDK、后端与 transport 身份。~~ 已交付：`getDiagnostics()` 携带协议版本、未知消息统计、peer 协议版本与 transport 身份；`getHealthSummary()`/`getMetrics()` 现在也会随单一对象输出实时 trace 指标与 sink 状态。
2. ~~统一 replay、dedup、trace、recovery 与 cluster 健康指标。~~ 已交付：`getDiagnostics()` + `getMetrics()` + `getHealthSummary()` 在单一快照中覆盖生命周期、恢复、dedup、replay、持久化、协议、transport、cluster、trace 指标与 sink 背压。
3. ~~优化 IndexedDB 并发 append 与清理路径。~~ 已交付：相邻 `appendBatch` 变更合并为单事务；`clear`/`clearTopic`/`clearBefore` 顺序保持。
4. ~~增加 adaptive dedup、async trace、prune 和长时多 Tab 性能基线。~~ 已交付：bench 覆盖负载加权评分、`getMetrics`、publishBatch 批次敏感性、adaptive dedup TTL、age 策略 replay prune、双 worker 跨 Tab fan-out，以及既有 dedup/async-sink/persistence 用例。

## 0.13.0 候选

1. ~~冻结公共导出面与 transport 无关的 publication 信封。~~ 已交付：根导出面由回归测试与 tag 间 `verify:compat` 门禁固定，transport 无关的 publication 信封（含 legacy/nested 帧兼容）已有文档与协议 fixture 覆盖。
2. ~~精确记录 at-least-once 投递与去重保证。~~ 已交付：architecture/API/capability 文档现在明确区分「每条已接受 transport publication 的本地至多一次扇出」与端到端投递，记录 transport/服务端的丢失与重复投递，并说明有界、可选 `messageId` 去重的边界，不再宣称 at-least-once 或 exactly-once。
3. ~~增加长时浏览器浸泡覆盖：replay 留存、重连、BFCache 与 owner 迁移。~~ 已交付：真实 Chromium 多 Tab 浸泡与重复 BFCache/reload/owner-handoff 场景在完整生命周期上连续运行。
4. ~~为 1.0 前的协议别名发布迁移指南与弃用策略。~~ 已交付：弃用策略位于发布清单，「Upgrading & Deprecation」指南已在两语言 getting-started 发布，legacy 协议帧在一个小版本内继续解析，当前版本通过 `getDiagnostics().protocol` 暴露。

## 更长期候选

1. **Replay 生命周期与留存**：增加持久化 `clear`/`clearTopic`，退订/替换时清理旧历史，并通过 trace 与 error handler 暴露持久化失败；
2. **可靠性诊断**：增加恢复/重试、owner ack、路由迁移结构化事件，元数据有界且默认关闭 trace；
3. **发布去重**：设计并实现可选、有界的 message-ID 窗口，覆盖本地分发、BroadcastChannel、WebSocket 与 replay，默认行为保持不变；
4. **适配层与协议对齐**：统一 React/Vue 生命周期和类型契约，补充二进制帧与恢复语义文档，并增加自定义 transport 兼容夹具；
5. **运维验证**：扩展浏览器和打包消费测试，增加去重/恢复/replay 清理回归基准，Push CI 继续作为发版门禁。
6. **TypeScript 7 工具链迁移**：阻塞在上游而非本仓库——截至 2026-09-22，`typescript-eslint` 最新发布仍为 8.70.1，其 peer 范围是 `typescript >=4.8.4 <6.1.0`，装上 TypeScript 7 会先让 lint 门禁失败。等 typescript-eslint 放宽该上限后再在独立分支迁移（TS 7 仍提供 `tsc` 可执行入口，`pnpm typecheck` 本身无需改动）。

## 发版检查清单

- 更新 `[Unreleased]` 与版本日期；
- 执行 `pnpm check`、`pnpm lint`、`pnpm test:e2e`、`pnpm bench`、`pnpm bench:browser`；
- 从打包 tarball 做 ESM/CJS 消费冒烟验证；
- 推送 tag 后核验 GitHub Release 与 npm `latest` dist-tag。
