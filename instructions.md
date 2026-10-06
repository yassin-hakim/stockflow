Purpose: This document is a mandatory design and implementation constraint for AI coding agents working on the Supy/StockFlow frontend.
Approved scope update: Implement the complete-app expansion under implementation/expansion/. Storage locations, receiving with simple supplier references, transfers, waste, physical counts, replenishment, menu recipes, a simple POS with recorded tender labels, sale corrections and operational reports are now required. These explicit requirements supersede the older scope exclusions below only for those capabilities. Preserve every design, accessibility, architecture and stock-safety constraint. Payment processing, authentication, advanced analytics and the other deferred features remain outside this release.
Approved reporting update: Paginate operational lists throughout the app, record cost per base unit when receiving items, and provide P&L for sales, ingredient costs and gross profit only. Operating expenses are excluded. Inventory owns cost valuation; Sales owns recorded sale/refund reporting; the BFF composes readable views and Angular presents owner-provided results. See docs/cost-reporting.md.
Repository: yassin-hakim/stockflow
Frontend: Angular 21, standalone components, Angular Router, signals, reactive forms and HttpClient.
Primary goal: Prevent generic AI-generated UI and ensure every new or modified screen feels like one coherent, deliberately designed product.
Before implementing, modifying, or generating a frontend screen, component, layout, form, table, empty state, modal, or visual interaction:
1. Read this document.
2. Read docs/frontend.md.
3. Read the relevant page specification under implementation/pages/.
4. Inspect the existing frontend implementation in apps/frontend/src/app/.
5. Inspect apps/frontend/src/styles.css and existing component styles.
6. Reuse the existing visual language before introducing anything new.
7. Only introduce a new pattern when the product requirement genuinely requires it.
Do not start from a generic AI dashboard template and adapt the content afterward.
The correct sequence is:
product task → information hierarchy → existing product patterns → layout → components → styling
Never:
generic modern UI → cards → gradients → content inserted afterward
Supy is a small restaurant inventory application used by restaurant employees.
The frontend exists to make a few operational tasks extremely clear:
- View current inventory.
- Identify products that are out, low, or adequately stocked.
- Create a product.
- Add stock.
- Remove stock.
- Understand why a stock action succeeded or failed.
- Review recent stock movements.
The application is intentionally scoped.
It is not:
- A marketing website.
- A consumer shopping application.
- A finance dashboard.
- A generic analytics SaaS.
- A social application.
- A CRM.
- A design-system showcase.
- A futuristic AI interface.
The interface should feel like a real internal restaurant operations tool: clear, efficient, calm, trustworthy, and intentionally designed.
Architectural complexity belongs in the backend. The UI should not visually expose technical architecture unless the user task requires it.
Every screen must answer:
1. What is the employee here to do?
2. What information is necessary for that task?
3. What is the most important piece of information?
4. What action should be easiest to discover?
5. What could go wrong?
6. What feedback does the employee need after acting?
If a visual element does not improve one of those things, question whether it belongs.
A screen does not become better because it contains more UI.
Prefer:
- hierarchy over decoration;
- clarity over novelty;
- density where operational data requires it;
- whitespace where it improves scanning;
- meaningful contrast over ornamental contrast;
- consistent patterns over constant variation.
These are hard constraints.
Do not automatically produce:
- purple/blue gradient backgrounds;
- giant hero headings;
- glassmorphism;
- frosted panels;
- glowing borders;
- floating gradient blobs;
- abstract decorative shapes;
- excessive rounded cards;
- huge rounded buttons;
- oversized icons;
- excessive shadows;
- neon accents;
- dark-mode-first dashboards;
- "AI" sparkle icons;
- decorative charts;
- arbitrary metric cards;
- fake activity feeds;
- excessive pill-shaped UI;
- centered everything;
- giant empty hero sections;
- three-column card grids simply because they look balanced.
These patterns are not forbidden because they are inherently bad. They are forbidden as automatic AI defaults.
Use them only when a specific product requirement or established Supy design language justifies them.
Cards are useful for grouping information.
They are not a universal container.
Do not turn:
- every table into a card;
- every paragraph into a card;
- every form field into a card;
- every statistic into a card;
- every page section into a card.
A page can use direct layout, dividers, table structure, whitespace, headings, or grouped sections without wrapping everything in a bordered box.
Whitespace is part of the hierarchy.
Do not fill unused space with:
- illustrations;
- gradients;
- blobs;
- decorative icons;
- charts with no decision value;
- oversized marketing copy.
Empty space is acceptable when it makes the operational interface easier to scan.
If a simple table solves the problem, do not replace it with a complicated collection of cards.
If a normal form solves the problem, do not create a multi-step wizard.
If a button solves the problem, do not create a floating action system.
If a status label solves the problem, do not create a visualization.
Complexity must come from the business problem, not from the agent trying to make the interface look sophisticated.
The existing frontend already establishes a useful visual direction. Preserve and refine it.
Current baseline characteristics include:
- Inter/system typography;
- warm, very light neutral page background;
- dark teal primary text;
- teal primary actions;
- white surfaces;
- subtle green-gray borders;
- restrained shadows;
- approximately 8–14px control/surface radii;
- compact operational controls;
- semantic tables;
- status badges;
- strong focus states;
- restrained error/success treatments.
The existing palette is intentionally calmer than the common AI-generated purple/blue SaaS palette.
Do not replace it with a completely different visual identity without a product-level reason.
The existing design should evolve as a system.
Use color to communicate hierarchy and state.
The established direction is:
- deep teal for primary text and primary actions;
- warm off-white/light neutral for the application background;
- white for primary surfaces;
- muted green-gray for secondary text and borders;
- restrained red for destructive/error states;
- restrained amber for low-stock/warning states;
- restrained green for healthy/success states.
Do not introduce a new accent color for an individual page.
Do not use gradients merely to create visual interest.
Do not use color as the only indication of state.
For inventory status:
- OUT must be visually distinct;
- LOW must be visually distinct;
- OK must be visually distinct;
- the status text itself must remain visible and understandable without color.
Color should support the information architecture, not replace it.
Typography should feel like an operational product, not a marketing landing page.
Use the existing typography stack unless a deliberate system change is justified.
Rules:
- Do not use oversized display typography for normal application screens.
- Page titles should establish hierarchy without dominating the interface.
- Section headings should be clearly subordinate to page titles.
- Body text should remain highly readable.
- Secondary information should be visually quieter but still accessible.
- Labels should be clear and consistent.
- Table headings may use compact uppercase styling where appropriate, as established by the existing UI.
- Avoid excessive font-weight changes.
Do not use typography as decoration.
For each page:
1. Establish the page title/context.
2. Place the primary action where the user naturally expects it.
3. Put the most important information first.
4. Group related information.
5. Put secondary information later.
6. Keep destructive or consequential actions visually clear without making them theatrically prominent.
Operational application pages generally work better with a strong reading axis.
Use:
- left-aligned page content;
- meaningful column relationships;
- consistent content widths;
- clear section starts.
Centered layouts are appropriate for:
- simple empty states;
- isolated confirmation states;
- not-found pages;
- very small focused forms where appropriate.
They should not become the default layout.
Do not force every page into a perfectly symmetrical grid.
Real operational interfaces often need:
- a wide data region and a narrower action region;
- a primary content column with supporting information;
- a title/action relationship;
- a dense history area below a focused action area.
Composition should follow task importance.
The inventory dashboard is an operational list, not a generic analytics dashboard.
Its primary purpose is to answer:
"What do we currently have, and what needs attention?"
The primary content should therefore be the inventory itself.
Required information:
- product name;
- category;
- quantity + unit;
- server-provided stock status.
Desktop:
- use a semantic table;
- keep columns aligned;
- make rows easy to scan;
- use whitespace and subtle separators rather than heavy cards;
- make the product name/action relationship obvious.
Mobile:
- use equivalent accessible cards/list items;
- preserve the same information;
- do not merely shrink a desktop table until it becomes unusable.
Do not add arbitrary KPI cards above the inventory.
Do not add fake analytics such as:
- "Total Inventory Value";
- "Stock Efficiency";
- "Monthly Movement";
- "Inventory Health Score";
unless those become explicit product requirements.
The product detail screen should establish a clear relationship between:
1. product identity;
2. current stock;
3. stock actions;
4. movement history.
The current quantity/status should be immediately understandable.
Stock actions should be visually prominent because they are the primary operations on this page.
Movement history should be information-dense and subordinate to the immediate action area.
Do not turn the product detail page into a collection of unrelated statistic cards.
Do not create a decorative "product overview" hero section.
Adding and removing stock are consequential actions.
The interface must make the difference between them obvious.
Use separate action areas when appropriate.
Each action requires:
- quantity;
- reason;
- clear action label;
- validation;
- pending/submitting state;
- success feedback;
- recoverable error feedback.
Do not rely on color alone to distinguish Add and Remove.
Do not use ambiguous labels such as:
- "Continue";
- "Submit";
- "Update";
- "Apply".
Prefer explicit labels such as:
- "Add stock";
- "Remove stock".
Never optimistically display a new inventory balance before the server confirms the operation.
The UI must respect the existing idempotency and pending-request behavior described in docs/frontend.md.
Do not sacrifice this behavior for animation or visual simplicity.
Forms should look like forms.
Do not turn simple product creation into a visually elaborate wizard.
For each field:
- provide a real label;
- keep the label associated with the control;
- show useful supporting text only when necessary;
- show validation close to the field;
- preserve user input after recoverable errors;
- clearly identify required fields;
- prevent accidental duplicate submission.
Use consistent field dimensions and spacing.
Do not create a different input style on every page.
Do not use placeholder text as a replacement for labels.
Do not hide important validation behind tooltips.
Tables are appropriate for StockFlow/Supy.
Do not replace tables with card grids simply because cards are visually fashionable.
For desktop tables:
- align numeric quantities consistently;
- keep headings clear;
- use subtle row separators;
- avoid excessive borders;
- avoid zebra striping unless it materially improves scanning;
- keep row height compact but comfortable;
- avoid unnecessary icons in every cell;
- use semantic table markup.
For movement history:
- date/time;
- movement type;
- signed quantity;
- unit;
- reason.
The movement sign is presentation logic:
- Add → +;
- Remove → −.
Do not alter the underlying API quantity semantics.
Stock status is business information.
The backend/BFF supplies the status.
The frontend must not invent a different status model.
Use:
- OUT;
- LOW;
- OK.
Status components should be compact and recognizable.
Avoid giant status illustrations.
Avoid emoji as status indicators.
Avoid excessive iconography.
A status badge should communicate state in approximately one glance.
Every remote view must intentionally handle:
1. loading;
2. successful empty state;
3. successful populated state;
4. failure state.
Do not design only the happy path.
Prefer restrained loading treatment.
Do not create elaborate skeleton systems for small datasets unless there is a measurable UX reason.
A simple loading state is often preferable.
Empty states should explain:
- what is empty;
- why the user might care;
- what the next useful action is.
For example, the inventory empty state should naturally lead to creating a product.
Do not use large decorative illustrations just because the page is empty.
Errors should:
- be visible;
- explain what happened in user terms;
- provide the next action when possible;
- never expose raw infrastructure errors.
Do not use generic "Something went wrong" when a useful error description is available.
Success feedback should be noticeable but restrained.
Do not create large celebratory animations for ordinary inventory operations.
The application has a small information architecture.
Current routes:
- /inventory
- /products/new
- /products/:id
- unknown route → not-found
Do not introduce a large SaaS sidebar/navigation system unless the product scope grows enough to justify it.
Do not add navigation items for hypothetical future features.
Do not create:
- Analytics;
- Reports;
- Suppliers;
- Purchasing;
- Settings;
- Users;
- Notifications;
merely because those are common SaaS navigation items.
The current product scope explicitly excludes them.
Before creating a new component:
1. Search for an existing equivalent.
2. Determine whether it can be reused.
3. Determine whether a small extension is better than duplication.
4. Only create a new component if the interaction is genuinely different.
Do not create multiple nearly identical components with slightly different styling.
Do not create page-specific versions of common:
- buttons;
- fields;
- status badges;
- panels;
- error states;
- tables;
- headings.
If a new pattern is necessary, make it consistent with the existing system.
Supy is an operational application.
The UI should not be excessively sparse.
Use enough whitespace to establish hierarchy, but keep related information close together.
Prefer consistent spacing increments.
Avoid:
- huge gaps between related controls;
- oversized cards;
- excessive vertical padding;
- enormous section margins.
The interface should feel calm and deliberate, not empty.
Use restrained radii.
Existing UI uses approximately:
- 8–9px controls;
- 14px larger panels;
- pill radius for status badges where appropriate.
Preserve this distinction.
Do not make every element rounded-full.
Do not use giant 24–32px rounded containers by default.
Use elevation sparingly.
A subtle border is often preferable to a shadow.
Avoid:
- floating card stacks;
- heavy shadows;
- glowing surfaces;
- glass effects.
Icons are supporting elements, not decoration.
Only use an icon when it improves recognition or interaction.
Do not put an icon beside every label.
Do not use random icon libraries simply to make a screen feel more complete.
Avoid:
- decorative sparkles;
- generic AI icons;
- arbitrary arrows;
- oversized line icons;
- icon-only actions without an accessible name.
If an icon-only button is genuinely appropriate, it must have an accessible label.
Motion should communicate state, not provide spectacle.
Acceptable examples:
- subtle focus transitions;
- button pending transitions;
- restrained page/state transitions;
- small feedback transitions.
Avoid:
- floating animations;
- animated gradients;
- bouncing cards;
- excessive entrance animations;
- parallax;
- decorative particle effects;
- animated dashboard metrics.
Normal inventory work should feel fast and predictable.
Desktop and mobile are not two unrelated designs.
They are two presentations of the same information hierarchy.
At narrow widths:
- preserve primary actions;
- preserve all required information;
- convert tables into accessible lists/cards where specified;
- stack action forms;
- prevent horizontal form overflow;
- maintain readable touch targets;
- keep error and validation messages visible.
Do not simply reduce font sizes until the desktop design technically fits.
Do not introduce a separate visual identity for mobile.
Accessibility is not a final cleanup task.
Every UI change must preserve:
- semantic HTML;
- associated labels;
- keyboard operation;
- visible focus;
- useful focus management;
- sufficient contrast;
- status/error announcements;
- meaningful button labels;
- accessible mobile equivalents.
Never communicate important information through color alone.
Never make an interaction mouse-only.
When developing a screen, use realistic domain data.
Examples:
- Arabica Coffee;
- kg;
- Coffee;
- 40 kg;
- LOW / OK / OUT;
- actual movement reasons.
Do not populate the UI with:
- "Lorem ipsum";
- fake random names;
- arbitrary metrics;
- placeholder charts;
- invented user avatars;
- fake notifications.
The visual hierarchy should be designed around the real information model.
The requirements explicitly exclude:
- authentication;
- authorization;
- user management;
- multi-restaurant administration;
- payments;
- suppliers;
- purchase orders;
- recipes;
- complex reports;
- advanced analytics;
- Kubernetes;
- CI/CD;
- Kafka;
- Redis;
- GraphQL;
- production-scale deployment.
The frontend must not quietly introduce UI for these concepts.
Do not add a sidebar with these features.
Do not add placeholder routes for these features.
Do not design screens for hypothetical requirements.
When asked to create a new screen, follow this process.
Write down internally:
- user;
- task;
- required information;
- primary action;
- secondary actions;
- failure conditions;
- success condition.
Find the closest existing screen.
Inspect:
- layout;
- typography;
- controls;
- spacing;
- borders;
- status treatment;
- responsive behavior;
- error handling.
Determine:
- primary content;
- secondary content;
- action priority;
- supporting information.
Do this before writing CSS.
Choose from existing patterns first:
- page heading + content;
- semantic table;
- form;
- two-column action area;
- detail + history;
- empty state;
- error state.
Do not invent a new composition just to make the screen different.
Reuse existing tokens and patterns.
Only add new primitives when necessary.
At minimum consider:
- loading;
- populated;
- empty;
- validation error;
- API error;
- submitting;
- success;
- mobile.
Before considering the work complete, ask:
Does this look like it belongs to the existing Supy product?
Then ask:
Could this exact screen have been generated by a generic AI prompt saying "modern SaaS dashboard"?
If the answer is yes, revise the design.
Every new screen must pass this test.
Reject the design if it contains several of these without a specific reason:
- generic hero section;
- oversized heading;
- gradient background;
- glass card;
- excessive cards;
- giant rounded corners;
- purple/blue accent;
- decorative blob;
- arbitrary chart;
- KPI cards;
- excessive iconography;
- excessive pill components;
- huge empty whitespace;
- centered everything;
- marketing-style copy;
- unnecessary animation.
A screen should have a recognizable relationship to the existing Supy interface.
If a screen needs to feel distinctive, achieve that through:
- information hierarchy;
- meaningful composition;
- operational density;
- typography;
- deliberate spacing;
- relationship between actions and data;
- context-aware status treatment;
- clear interaction design.
Do not achieve differentiation through visual gimmicks.
The goal is not to make every page visually unusual.
The goal is to make the product visually coherent and professionally designed.
"Modern" is not a design requirement.
Do not interpret "make it modern" as:
- gradient;
- glass;
- huge typography;
- rounded cards;
- animation;
- dark mode;
- purple;
- floating UI.
For Supy, modern means:
- clear;
- efficient;
- responsive;
- accessible;
- visually consistent;
- restrained;
- task-oriented;
- professionally composed.
Visual changes must never alter business behavior.
The UI must continue to respect:
- BFF-only communication;
- server-provided inventory status;
- three-decimal quantities;
- required stock-action reasons;
- no optimistic stock decrement;
- idempotency keys;
- pending request recovery;
- server-side validation;
- movement history ordering;
- UTC API timestamps with local display;
- explicit loading/empty/error states.
Never simplify the UI by removing a safety mechanism.
Never change business semantics for visual convenience.
A frontend change is not complete until:
- The design serves the actual user task.
- No hypothetical product features were introduced.
- Information hierarchy is clear.
- It belongs to the existing Supy visual language.
- No generic AI aesthetic was introduced without justification.
- Color is restrained and meaningful.
- Typography is consistent.
- Spacing is intentional.
- Borders/radii/elevation are consistent.
- Cards are used only where useful.
- Primary action is obvious.
- Destructive/consequential actions are clear.
- Loading/submitting states exist.
- Success and failure states exist.
- Empty states exist where applicable.
- Desktop layout works.
- Mobile layout works.
- Tables have an appropriate mobile equivalent where required.
- Forms do not overflow horizontally.
- Labels are associated with fields.
- Keyboard interaction works.
- Focus states remain visible.
- Status is not communicated by color alone.
- Error/success feedback is announced appropriately.
- Existing components/patterns were reused where possible.
- No unnecessary component duplication was introduced.
- Existing API and business semantics remain unchanged.
- Tests are updated when behavior changes.
Do not design Supy from scratch every time you receive a frontend task.
You are extending an existing product.
Your responsibility is to make the new interface look like it was designed by the same product team that designed the rest of Supy.
Prefer the existing design language over your model's default design tendencies.
Prefer the simplest composition that solves the user's task.
Prefer real product information over decorative UI.
Prefer consistency over novelty.
Prefer operational clarity over visual spectacle.
If a design decision is ambiguous, preserve the existing Supy pattern instead of inventing a new one.
The frontend should look like a deliberate product.
It should not look like an AI-generated collection of screens.
