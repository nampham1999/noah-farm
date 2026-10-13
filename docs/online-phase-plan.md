# Noah Farm – Kế hoạch giai đoạn online

Tài liệu này đề xuất các tính năng chơi cùng nhau cho giai đoạn sau, dựa trên những game nông trại và game "cozy" tương tự. Hiện game chạy hoàn toàn trên trình duyệt, không có máy chủ (GDD mục 8). Phần xã hội đang có:

- link thăm nông trại dạng ảnh chụp, chỉ xem;
- link mời nhận 500 vàng.

Mọi thứ dưới đây cần thêm một backend.

## 1. Nguyên tắc

- **Bất đồng bộ trước, thời gian thực sau.** Phần lớn niềm vui của game nông trại online đến từ việc ghé thăm, tặng quà, giúp nhau lúc nào cũng được, không cần hai người online cùng lúc. Cách này cũng rẻ và dễ làm hơn nhiều.
- **Không đối đầu.** Không cướp phá, không PvP. Chỉ có giúp đỡ, trao đổi và thi đua nhẹ, giữ đúng chất "cozy".
- **Vẫn chơi được khi mất mạng.** Nông trại của mình luôn chạy trên máy như bây giờ; phần online chỉ là lớp thêm vào.
- **Chỉ kiểm tra những gì ảnh hưởng người khác.** Tài nguyên trong nông trại của mình vẫn để máy người chơi tự tính như hiện tại. Quà, giao dịch và bảng xếp hạng thì phải qua máy chủ kiểm tra.
- **An toàn cho mọi lứa tuổi.** Ưu tiên câu nói có sẵn và biểu tượng cảm xúc thay vì chat tự do.

## 2. Các game tham khảo

| Game | Tính năng online nổi bật | Bài học cho Noah Farm |
|---|---|---|
| **Hay Day** | Hàng xóm ghé giúp; xin trợ giúp khi thiếu hàng giao; quầy ven đường bán cho người khác; tờ báo quảng cáo hàng; hội hàng xóm và sự kiện Derby hằng tuần | Mô hình mẫu cho lối chơi bất đồng bộ: **xin giúp**, **chợ giữa người chơi**, **hội và nhiệm vụ chung theo tuần** |
| **FarmVille / FarmVille 2** | Gửi quà miễn phí mỗi ngày; ghé tưới và bón giúp bạn; cả hai cùng được thưởng | **Quà hằng ngày** và **giúp khi ghé thăm**: đơn giản mà giữ chân người chơi rất tốt |
| **Township** | Hợp tác cùng nhau, đua thuyền Regatta, giúp nhau làm đầy tàu hàng | Mục tiêu chung cả nhóm theo mùa, gắn với lễ hội |
| **Stardew Valley** | Chơi chung một nông trại 2–4 người, mỗi người một nhà nhỏ, chung hoặc riêng tiền | **Chơi chung thật** rất được yêu thích nhưng khó làm (đồng bộ từng thao tác); để giai đoạn cuối |
| **Animal Crossing: New Horizons** | Mời bạn qua đảo bằng mã; "địa chỉ giấc mơ" (đi dạo bản chụp đảo người khác); gửi thư kèm quà; trao đổi củ cải giá khác nhau giữa các đảo | Noah Farm đã có bản chụp giống "giấc mơ". Có thể thêm **thăm trực tiếp**, **thư và quà**, **giá chợ khác nhau giữa các nông trại** |
| **Sky: Children of the Light** | Mỗi ngày tặng "nến" cho bạn bè; tình bạn mở dần cách tương tác; không chat tự do với người lạ | Một **"đồng tiền tình bạn"** tặng nhau mỗi ngày; mở tương tác theo mức thân; an toàn |
| **Palia, Sun Haven** | Thế giới cozy nhiều người: câu cá, nấu ăn, làm vườn theo nhóm, có thưởng nhóm | **Hoạt động nhóm ngắn** như câu cá chung ở hồ, nấu chung một nồi lớn |
| **Pokémon GO** (khía cạnh xã hội) | Quà bạn bè mỗi ngày, cấp độ bạn bè tăng theo tương tác, có thưởng | Cấp độ bạn bè giữa người chơi, giống cấp tim với dân làng đã có |

## 3. Tính năng đề xuất

### 3.1 Nền tảng (bắt buộc làm trước)

- **Tài khoản và lưu đám mây.**
  - Lúc đầu đăng nhập ẩn danh không cần hỏi gì; sau đó có thể liên kết Google, Apple hoặc email.
  - Một nông trại chơi tiếp được trên điện thoại lẫn máy tính.
  - Hai máy lệch nhau thì hỏi người chơi giữ bản nào.
- **Hồ sơ người chơi.** Tên, ảnh chân dung (đã có, lấy từ nhân vật tự tạo), cấp, mã bạn bè ngắn.

### 3.2 Bất đồng bộ (giá trị cao, làm sớm)

| Tính năng | Mô tả | Tham khảo |
|---|---|---|
| **Bạn bè** | Kết bạn bằng mã, link mời hoặc QR. Danh sách bạn hiện ai vừa chơi gần đây. Người mời được thưởng thật (bây giờ có máy chủ để xác nhận). | Hay Day, Pokémon GO |
| **Thăm trực tiếp** | Nông trại bạn luôn là bản mới nhất lấy từ đám mây, không phải ảnh chụp cũ. | Animal Crossing |
| **Giúp khi ghé thăm** | Mỗi ngày tưới giúp tối đa 5 ô, vuốt ve vật nuôi, đuổi cáo cho bạn. Cả hai được ít vàng và XP. | FarmVille |
| **Quà hằng ngày** | Mỗi ngày gửi mỗi bạn một món miễn phí (hạt giống, cỏ khô, trứng). Bạn mở hộp quà khi vào game. | FarmVille, Sky |
| **Cấp bạn bè** | Mỗi lần giúp hoặc tặng tăng điểm thân; lên cấp thì được món trang trí "hữu nghị". | Pokémon GO, cấp tim dân làng |
| **Xin trợ giúp** | Thiếu hàng cho đơn của dân làng thì đăng "Cần 3 trứng"; bạn gửi giúp, cả hai được thưởng. | Hay Day |
| **Sổ khách và thư** | Khách để lại sticker hoặc câu chúc có sẵn; gửi thư kèm một món quà. | Animal Crossing |
| **Bảng xếp hạng lễ hội** | Thi câu cá mùa hè, hội chợ mùa thu… so điểm với bạn bè và toàn server, có quà theo hạng. | Hay Day Derby, Township Regatta |

### 3.3 Kinh tế giữa người chơi (làm sau, cần kiểm soát chặt)

- **Quầy ven đường.** Bày tối đa 6 món với giá tự đặt; bạn bè và người lạ ghé mua. Tham khảo Hay Day.
- **Bảng tin chợ.** Xem các quầy đang bán món mình cần.
- **Bắt buộc:**
  - Máy chủ giữ hàng trong lúc đang bày bán.
  - Giá có trần và sàn theo giá gốc.
  - Giới hạn số giao dịch mỗi ngày.
  - Ghi lại mọi giao dịch để chống nhân bản đồ và chuyển vàng giữa các tài khoản.

### 3.4 Hội làng

- Nhóm 5–20 người cùng một "làng", có bảng tin chung.
- **Nhiệm vụ chung theo tuần**, ví dụ "cả làng giao 300 đơn hàng". Xong thì mọi người được quà; có bảng xếp hạng giữa các làng. Tham khảo Hay Day Derby.
- **Kho chung:** góp nông sản để mở công trình chung, như cầu, đài phun nước, tượng của làng, hiện trong nông trại mọi thành viên.

### 3.5 Thời gian thực nhẹ

- **Đi dạo cùng nhau.** Khi đang thăm, thấy nhân vật của nhau đi lại, vẫy tay, dùng biểu cảm có sẵn (vui, tim, ngủ…) và câu nói nhanh. Không chat tự do với người lạ; chỉ mở chat chữ cho bạn bè đã kết bạn nếu thấy cần.
- **Câu cá chung.** Hai đến bốn người cùng đứng ở hồ; mỗi con cá ai câu được đều cộng vào điểm chung, đủ điểm thì có quà hiếm.
- **Thông báo thật.** Có máy chủ thì gửi được thông báo đẩy kể cả khi app đã đóng (cây chín, bạn gửi quà, có người xin giúp). Giới hạn hiện tại của mục 12 sẽ hết.

### 3.6 Chơi chung một nông trại (cuối cùng, có thể không làm)

Hai đến bốn người cùng làm một nông trại như Stardew Valley. Việc này cần máy chủ giữ trạng thái chung và đồng bộ từng thao tác (cuốc, tưới, mua…), gần như phải viết lại vòng lặp game. Chỉ nên cân nhắc khi các phần trên đã chạy tốt và có nhiều người yêu cầu.

## 4. Kỹ thuật

### 4.1 Chọn backend

GDD mục 8.3 đã chốt: dùng dịch vụ có sẵn và **đặt backend ở một repo riêng**.

| Lựa chọn | Ưu | Nhược | Hợp với |
|---|---|---|---|
| **Supabase** (khuyên dùng) | Có sẵn Postgres, đăng nhập (kể cả ẩn danh), Realtime (broadcast và theo dõi ai đang online), Edge Functions; dữ liệu dạng bảng hợp với bạn bè, giao dịch, bảng xếp hạng; có gói miễn phí | Realtime giới hạn số kết nối ở gói miễn phí | Mục 3.1–3.5 |
| Firebase | Firestore và đăng nhập rất dễ dùng, SDK tốt cho web | Truy vấn dạng bảng (xếp hạng, chợ) kém linh hoạt; dễ tốn chi phí theo số lần đọc | 3.1–3.2 |
| Cloudflare Durable Objects / PartyKit | Phòng chơi thời gian thực độ trễ thấp, rẻ | Phải tự lo lưu trữ và đăng nhập | 3.5, 3.6 |

**Đề xuất:** Supabase cho toàn bộ, chỉ cân nhắc thêm Durable Objects nếu làm mục 3.6. Giới hạn của các gói miễn phí đổi theo thời gian, cần xem lại lúc bắt đầu làm.

### 4.2 Phía game (repo này)

- **Lưu đám mây:** thêm `CloudSaveStore` theo đúng giao diện `SaveStore` có sẵn.
  - Lưu trên máy trước, đồng bộ lên mây sau.
  - Mỗi bản lưu kèm `updatedAt` và checksum như hiện tại.
  - Hai bản lệch nhau thì hỏi người chơi giữ bản nào.
- **Hàng đợi khi mất mạng:** quà, giúp đỡ, đơn xin giúp được xếp hàng chờ, có mạng lại thì gửi.
- **Tái dùng chế độ thăm:** chế độ thăm có sẵn (`#visit=`) chuyển sang đọc nông trại từ máy chủ.
- **Tách cờ thử nghiệm:** `?max` và các tham số thử chỉ hoạt động khi chưa đăng nhập, hoặc đánh dấu save là "thử nghiệm" để không vào bảng xếp hạng và chợ.

### 4.3 Dữ liệu chính (phía backend)

| Bảng | Nội dung |
|---|---|
| `profiles` | Tên, mã bạn bè, ảnh chân dung, cấp |
| `saves` | Bản lưu (jsonb), phiên bản, checksum, thời điểm cập nhật |
| `friendships` | Hai người, trạng thái, điểm thân |
| `gifts` | Người gửi, người nhận, món, ngày, đã mở chưa |
| `help_actions` | Ai giúp ai, việc gì, ngày (để giới hạn số lần mỗi ngày) |
| `help_requests` | Món cần, số lượng, đã đủ chưa |
| `guestbook` | Sticker hoặc câu nói có sẵn để lại khi thăm |
| `market_listings` / `trades` | Hàng đang bày, giá; lịch sử giao dịch |
| `villages` / `village_goals` | Hội làng, nhiệm vụ tuần, tiến độ |
| `leaderboards` | Điểm lễ hội theo mùa |

### 4.4 Chống gian lận và an toàn

- Người chơi tự tính tài nguyên nên có thể sửa save. Vì vậy mọi việc **chuyển đồ hoặc vàng sang người khác** và **ghi điểm xếp hạng** đều phải qua Edge Function kiểm tra:
  - giới hạn mỗi ngày;
  - giá trần và sàn;
  - điểm hợp lý so với thời gian chơi.
- **Tên người chơi:** lọc từ xấu; có nút báo cáo và chặn.
- **Không chat tự do** với người lạ (xem mục 3.5).
- **Quyền riêng tư:** chỉ lưu những gì cần; cho phép xoá tài khoản và toàn bộ dữ liệu.

## 5. Lộ trình đề xuất

| Bước | Nội dung | Độ khó |
|---|---|---|
| 6.1 | Tài khoản ẩn danh, lưu đám mây, hồ sơ, mã bạn bè | Vừa |
| 6.2 | Bạn bè, thăm trực tiếp, quà hằng ngày, giúp khi ghé thăm, cấp bạn bè | Vừa |
| 6.3 | Xin trợ giúp, sổ khách, thư, thông báo đẩy thật | Vừa |
| 6.4 | Bảng xếp hạng lễ hội | Dễ |
| 6.5 | Hội làng và nhiệm vụ tuần | Khó |
| 6.6 | Quầy ven đường và chợ | Khó (phải chống gian lận) |
| 6.7 | Đi dạo cùng nhau, câu cá chung | Khó |
| 6.8 | (Tuỳ chọn) chơi chung một nông trại | Rất khó |

Bước 6.1–6.3 đã cho cảm giác "có bạn bè" rõ rệt mà chưa cần thời gian thực. Nên ra mắt tới đây rồi xem người chơi dùng gì nhiều nhất, trước khi làm tiếp.

## 6. Rủi ro

- **Chi phí:** khi đông người, gói miễn phí sẽ hết. Cần theo dõi số người dùng và số kết nối Realtime.
- **Gian lận và kinh tế lệch:** nếu mở chợ quá sớm hoặc thiếu giới hạn, đồ và vàng bị nhân bản sẽ lan sang người khác.
- **An toàn trẻ em:** chat, tên, ảnh. Giữ câu nói có sẵn là chính.
- **Phụ thuộc nhà cung cấp:** giữ phần game độc lập qua `SaveStore`; đổi backend thì không phải sửa logic game.
- **Mạng yếu trên điện thoại:** mọi thao tác online phải chịu được mất mạng và gửi lại.

## 7. Việc cần quyết định trước khi làm

1. Chọn backend: Supabase hay Firebase.
2. Có làm chợ giữa người chơi không, hay chỉ tặng quà và giúp đỡ.
3. Có chat chữ cho bạn bè không, hay chỉ câu nói có sẵn và biểu cảm.
4. Độ tuổi người chơi chính (ảnh hưởng tới đăng nhập, chat, quyền riêng tư).
5. Có định thu phí hoặc quảng cáo không (ảnh hưởng tới cách thưởng và chống gian lận).
