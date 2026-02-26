# LancsChat Setup & Launch Guide

## Current Status

### ✅ What's Working
- User authentication via Supabase Auth
- Email verification (needs templates uploaded)
- Real-time chat in multiple rooms
- Direct messaging between users
- Message persistence (SQLite backend)
- Anonymous display names with avatar colors

### 🔧 What Needs Setup

## 1. Supabase Configuration

### A. Email Templates (Required for signup)
1. Go to **Supabase Dashboard** → **Authentication** → **Email Templates**
2. Upload the HTML templates from `email-templates/`:
   - **Confirm signup**: Paste content from `confirm-signup.html`
   - **Reset password**: Paste content from `reset-password.html`
3. Upload Lancaster logo to Supabase Storage:
   - Create bucket: `assets` (public)
   - Upload `client/public/Lancaster-Logo.png`
   - Update image URLs in email templates

### B. Storage for Profile Pictures
1. Go to **Storage** → **Create new bucket**
2. Name: `avatars`
3. Set to **Public**
4. Add RLS policies:
   ```sql
   -- Allow authenticated users to upload their own avatar
   CREATE POLICY "Users can upload own avatar"
   ON storage.objects FOR INSERT
   TO authenticated
   WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

   -- Allow public read access
   CREATE POLICY "Public avatar access"
   ON storage.objects FOR SELECT
   TO public
   USING (bucket_id = 'avatars');
   ```

### C. JWT Secret (Optional but Recommended)
1. Go to **Settings** → **API**
2. Copy **JWT Secret** (under "Config")
3. Add to `server/.env`:
   ```
   SUPABASE_JWT_SECRET=your-actual-jwt-secret-here
   ```

## 2. Features to Build

### Phase 1: Core Polish (Week 1)
- [x] Fix input cursor padding
- [ ] Redesign sidebar - cleaner, less cluttered
- [ ] Simplify welcome screen
- [ ] Add Settings page with profile editing
- [ ] Profile picture upload

### Phase 2: Random Chat (Week 2)
- [ ] Build matching queue system
- [ ] Random chat pairing algorithm
- [ ] "Next" button to skip to new match
- [ ] Chat history for random chats (optional)

### Phase 3: Feedback & Analytics (Week 3)
- [ ] Feedback form in Settings
- [ ] Feature request submission
- [ ] Basic analytics (user count, messages sent)
- [ ] Admin dashboard (optional)

### Phase 4: Advanced Features (Future)
- [ ] Video/voice chat (WebRTC)
- [ ] Image sharing
- [ ] Reactions to messages
- [ ] User blocking/reporting
- [ ] Moderation tools

## 3. Launch Strategy

### Soft Launch (Week 1-2)
**Goal**: Get 50-100 early users, gather feedback

1. **Create Marketing Materials**
   - Design simple posters (A4, QR code to site)
   - Create Instagram account (@lancschat)
   - Write 3-4 social posts

2. **Distribution**
   - Print 20-30 posters
   - Place in high-traffic areas:
     - Library entrance
     - Student Union
     - Lecture halls
     - Coffee shops on campus
   - Post in Lancaster student Facebook groups
   - Share in course group chats

3. **Messaging**
   - "Anonymous chat for Lancaster students"
   - "Meet new people, stay anonymous"
   - "Verified @lancaster.ac.uk emails only"

### Feedback Collection
- In-app feedback form (Settings page)
- Weekly check-ins with early users
- Monitor most-used features
- Track bugs and feature requests

### Growth Phase (Month 2-3)
**Goal**: Reach 500+ active users

1. **Word of Mouth**
   - Incentivize sharing (optional)
   - Create shareable moments
   - Encourage organic growth

2. **Events**
   - Host "LancsChat meetup" (optional)
   - Partner with societies
   - Sponsor small events

3. **Features Based on Feedback**
   - Prioritize most-requested features
   - Fix critical bugs immediately
   - Iterate quickly

## 4. Technical Considerations

### Scaling
- **Current**: SQLite on single server (good for 1000s of users)
- **Next**: Migrate to Supabase Postgres (10k+ users)
- **Future**: Add Redis for caching, CDN for assets

### Moderation
- **Phase 1**: Manual review of reports
- **Phase 2**: Automated content filtering
- **Phase 3**: Community moderators

### Privacy & Safety
- Never expose real emails
- Allow users to delete accounts
- Implement blocking/reporting
- Clear privacy policy
- GDPR compliance (if needed)

## 5. Legal & Safety

### Required
- [ ] Privacy Policy
- [ ] Terms of Service
- [ ] Community Guidelines
- [ ] Report abuse mechanism

### Recommended
- [ ] Age verification (18+)
- [ ] Content moderation plan
- [ ] Data retention policy
- [ ] Backup strategy

## 6. Monetization (Optional, Future)

### Free Features
- Basic chat
- Random matching
- Profile customization

### Premium (£2-3/month)
- Custom avatar upload
- Priority matching
- Ad-free experience
- Custom themes
- Message history export

## 7. Success Metrics

### Week 1
- 50 signups
- 10 daily active users
- 100+ messages sent

### Month 1
- 200 signups
- 50 daily active users
- 5000+ messages sent

### Month 3
- 500+ signups
- 150+ daily active users
- 20k+ messages sent

## Next Steps

1. **Immediate** (Today)
   - Upload email templates to Supabase
   - Create avatars storage bucket
   - Test signup flow end-to-end

2. **This Week**
   - Build Settings page
   - Add profile picture upload
   - Redesign welcome screen
   - Create poster design

3. **Next Week**
   - Print posters
   - Start soft launch
   - Monitor feedback
   - Fix bugs

## My Advice

**Keep it simple for now.** Focus on:
1. Making the core chat experience great
2. Getting your first 50 users
3. Listening to feedback
4. Iterating quickly

Don't build video chat or complex features until you validate that people actually want to use the basic product. The random chat feature is a great differentiator - prioritize that.

Put up posters, share in group chats, and see what happens. If you get traction, you'll know what to build next based on user requests.

The feedback form is crucial - make it super easy for users to tell you what they want. That's your product roadmap.
