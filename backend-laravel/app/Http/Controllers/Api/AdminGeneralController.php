<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminGeneralController extends Controller
{
    public function dashboard()
    {
        $restaurantCounts = Restaurant::query()
            ->select('status', DB::raw('COUNT(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');
        $today = now()->toDateString();
        $orderStats = Order::query()
            ->selectRaw('COUNT(*) as total_orders')
            ->selectRaw('SUM(CASE WHEN DATE(created_at) = ? THEN 1 ELSE 0 END) as orders_today', [$today])
            ->selectRaw("SUM(CASE WHEN status IN ('served', 'paid') THEN total_amount ELSE 0 END) as gross_order_revenue")
            ->first();

        $trendStart = now()->subDays(6)->startOfDay();
        $dailyOrders = Order::query()
            ->where('created_at', '>=', $trendStart)
            ->selectRaw('DATE(created_at) as date')
            ->selectRaw('COUNT(*) as orders')
            ->selectRaw("SUM(CASE WHEN status IN ('served', 'paid') THEN total_amount ELSE 0 END) as revenue")
            ->groupByRaw('DATE(created_at)')
            ->orderBy('date')
            ->get()
            ->keyBy('date');

        $trend = collect(range(0, 6))->map(function (int $offset) use ($trendStart, $dailyOrders): array {
            $date = $trendStart->copy()->addDays($offset)->toDateString();
            $day = $dailyOrders->get($date);

            return [
                'date' => $date,
                'orders' => (int) ($day?->orders ?? 0),
                'revenue' => (float) ($day?->revenue ?? 0),
            ];
        });

        return response()->json([
            'restaurants' => [
                'total' => (int) $restaurantCounts->sum(),
                'active' => (int) ($restaurantCounts['active'] ?? 0),
                'pending' => (int) ($restaurantCounts['pending'] ?? 0),
                'rejected' => (int) ($restaurantCounts['rejected'] ?? 0),
                'suspended' => (int) ($restaurantCounts['suspended'] ?? 0),
            ],
            'users' => [
                'staff' => User::query()->whereNotNull('restaurant_id')->count(),
                'customers' => null,
            ],
            'orders' => [
                'total' => (int) ($orderStats->total_orders ?? 0),
                'today' => (int) ($orderStats->orders_today ?? 0),
                'gross_revenue' => (float) ($orderStats->gross_order_revenue ?? 0),
            ],
            'subscriptions' => [
                'active' => null,
                'expired' => null,
                'revenue' => null,
            ],
            'trend' => $trend,
            'recent_restaurants' => Restaurant::query()
                ->with('partner:id,restaurant_id,name,email')
                ->latest()
                ->limit(5)
                ->get(['id', 'name', 'email', 'status', 'created_at']),
        ]);
    }

    public function restaurants(Request $request)
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['pending', 'active', 'rejected', 'suspended'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $restaurants = Restaurant::query()
            ->with('partner:id,restaurant_id,name,email')
            ->withCount(['users', 'tables', 'products', 'orders'])
            ->when(
                filled($validated['search'] ?? null),
                fn ($query) => $query->where(function ($query) use ($validated): void {
                    $search = '%'.$validated['search'].'%';
                    $query->where('name', 'like', $search)
                        ->orWhere('email', 'like', $search)
                        ->orWhere('phone', 'like', $search)
                        ->orWhereHas('partner', fn ($partnerQuery) => $partnerQuery->where('name', 'like', $search));
                }),
            )
            ->when(
                filled($validated['status'] ?? null),
                fn ($query) => $query->where('status', $validated['status']),
            )
            ->latest()
            ->paginate(10);

        return response()->json($restaurants);
    }

    public function restaurantDetail(Request $request, Restaurant $restaurant)
    {
        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'restaurant.viewed_by_admin',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
        ]);

        return response()->json($restaurant->load([
            'partner:id,restaurant_id,name,email',
            'users:id,restaurant_id,name,email,role,created_at',
        ])->loadCount(['users', 'tables', 'products', 'orders']));
    }

    public function updateRestaurant(Request $request, Restaurant $restaurant)
    {
        $partner = $restaurant->partner;
        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255', Rule::unique('restaurants', 'email')->ignore($restaurant->id)],
            'partner_name' => ['sometimes', 'required', 'string', 'max:255'],
            'partner_email' => [
                'sometimes',
                'required',
                'email',
                'max:255',
                Rule::unique('users', 'email')->ignore($partner?->id),
            ],
        ]);

        DB::transaction(function () use ($request, $restaurant, $partner, $validated): void {
            $restaurant->update(collect($validated)->only(['name', 'address', 'phone', 'email'])->all());

            if ($partner && (array_key_exists('partner_name', $validated) || array_key_exists('partner_email', $validated))) {
                $partner->update([
                    'name' => $validated['partner_name'] ?? $partner->name,
                    'email' => $validated['partner_email'] ?? $partner->email,
                ]);
            }

            AuditLog::create([
                'actor_id' => $request->user()->id,
                'restaurant_id' => $restaurant->id,
                'action' => 'restaurant.updated_by_admin',
                'target_type' => Restaurant::class,
                'target_id' => $restaurant->id,
                'metadata' => ['fields' => array_keys($validated)],
            ]);
        });

        return response()->json($restaurant->fresh()->load([
            'partner:id,restaurant_id,name,email',
            'users:id,restaurant_id,name,email,role,created_at',
        ])->loadCount(['users', 'tables', 'products', 'orders']));
    }

    public function restaurantActivity(Request $request, Restaurant $restaurant)
    {
        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'restaurant.activity_viewed',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
        ]);

        return response()->json(
            AuditLog::query()
                ->with('actor:id,name,email')
                ->where('restaurant_id', $restaurant->id)
                ->latest()
                ->paginate(20),
        );
    }

    public function recordPartnerConsultation(Request $request, Restaurant $restaurant)
    {
        $validated = $request->validate([
            'section' => ['required', Rule::in(['subscription'])],
        ]);

        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'restaurant.section_consulted',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
            'metadata' => ['section' => $validated['section']],
        ]);

        return response()->json(['message' => 'Consultation enregistrée.']);
    }

    public function startPartnerView(Request $request, Restaurant $restaurant)
    {
        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.started',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
            'metadata' => ['restaurant_name' => $restaurant->name],
        ]);

        return response()->json([
            'restaurant_id' => $restaurant->id,
            'restaurant_name' => $restaurant->name,
        ]);
    }

    public function stopPartnerView(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['required', 'integer', 'exists:restaurants,id'],
        ]);
        if ($request->header('X-Admin-View-Restaurant') !== null) {
            abort_unless(
                (int) $request->header('X-Admin-View-Restaurant') === (int) $validated['restaurant_id'],
                403,
                'Le restaurant consulté ne correspond pas à cette session.',
            );
        }
        $restaurant = Restaurant::findOrFail($validated['restaurant_id']);

        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.ended',
            'target_type' => Restaurant::class,
            'target_id' => $restaurant->id,
        ]);

        return response()->json(['message' => 'Consultation terminée.']);
    }

    public function updateRestaurantStatus(Request $request, Restaurant $restaurant)
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in(['active', 'rejected', 'suspended'])],
            'reason' => ['required_if:status,suspended', 'nullable', 'string', 'max:2000'],
        ]);
        $previousStatus = $restaurant->status;

        abort_if(
            $previousStatus === 'rejected' && $validated['status'] === 'suspended',
            422,
            'Un restaurant refusé ne peut pas être suspendu.',
        );

        DB::transaction(function () use ($request, $restaurant, $validated, $previousStatus): void {
            $restaurant->update([
                'status' => $validated['status'],
                'suspension_reason' => $validated['status'] === 'suspended' ? $validated['reason'] : null,
                'suspended_at' => $validated['status'] === 'suspended' ? now() : null,
            ]);

            AuditLog::create([
                'actor_id' => $request->user()->id,
                'restaurant_id' => $restaurant->id,
                'action' => 'restaurant.status_updated',
                'target_type' => Restaurant::class,
                'target_id' => $restaurant->id,
                'metadata' => [
                    'from' => $previousStatus,
                    'to' => $validated['status'],
                    'reason' => $validated['reason'] ?? null,
                ],
            ]);
        });

        return response()->json([
            'id' => $restaurant->id,
            'status' => $restaurant->status,
            'suspension_reason' => $restaurant->suspension_reason,
            'suspended_at' => $restaurant->suspended_at,
        ]);
    }
}
