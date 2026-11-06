<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApiToken;
use App\Models\AuditLog;
use App\Models\Restaurant;
use App\Models\RestaurantSetting;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);
        $user = User::where('email', $credentials['email'])->first();

        if (
            ! $user
            || ! Hash::check($credentials['password'], $user->password)
            || (! $user->restaurant_id && $user->role !== 'admin')
        ) {
            return response()->json(['message' => 'Adresse e-mail ou mot de passe incorrect.'], 422);
        }

        if ($user->restaurant_id && $user->restaurant?->status !== 'active') {
            $message = match ($user->restaurant?->status) {
                'pending' => 'Votre inscription est en attente de validation.',
                'rejected' => 'Votre demande d’inscription a été refusée.',
                'suspended' => 'L’accès à votre restaurant est suspendu.',
                default => 'Votre compte partenaire est indisponible.',
            };

            return response()->json(['message' => $message], 403);
        }

        return response()->json($this->issueTokens($user));
    }

    public function register(Request $request)
    {
        $validated = $request->validate([
            'restaurant_name' => ['required', 'string', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email', 'unique:restaurants,email'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        DB::transaction(function () use ($validated): void {
            $restaurant = Restaurant::create([
                'name' => $validated['restaurant_name'],
                'email' => $validated['email'],
                'phone' => $validated['phone'] ?? null,
                'address' => $validated['address'] ?? null,
                'status' => 'pending',
            ]);

            RestaurantSetting::create([
                'restaurant_id' => $restaurant->id,
                'feature_flags' => [
                    'qr_ordering' => true,
                    'reservations' => true,
                    'inventory' => true,
                    'kitchen' => true,
                    'reports' => true,
                ],
            ]);

            User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => $validated['password'],
                'role' => 'partner',
                'restaurant_id' => $restaurant->id,
            ]);

            AuditLog::create([
                'restaurant_id' => $restaurant->id,
                'action' => 'restaurant.registered',
                'target_type' => Restaurant::class,
                'target_id' => $restaurant->id,
                'metadata' => ['status' => 'pending'],
            ]);
        });

        return response()->json([
            'message' => 'Demande d’inscription envoyée. Vous pourrez vous connecter après sa validation.',
        ], 201);
    }

    public function adminSetup(Request $request)
    {
        $this->ensureLocalAdminSetupRequest($request);
        abort_if(
            User::where('role', 'admin')->whereNull('restaurant_id')->exists(),
            409,
            'Un compte admin général existe déjà.',
        );

        $setupKey = Cache::remember(
            'admin_setup_key',
            now()->addMinutes(15),
            fn (): string => Str::random(48),
        );

        return response()->json(['setup_key' => $setupKey]);
    }

    public function registerAdmin(Request $request)
    {
        $this->ensureLocalAdminSetupRequest($request);
        abort_if(
            User::where('role', 'admin')->whereNull('restaurant_id')->exists(),
            409,
            'Un compte admin général existe déjà.',
        );

        $validated = $request->validate([
            'setup_key' => ['required', 'string'],
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ]);
        $expectedSetupKey = Cache::get('admin_setup_key');

        if (! is_string($expectedSetupKey) || ! hash_equals($expectedSetupKey, $validated['setup_key'])) {
            return response()->json(['message' => 'Code d’installation invalide ou non configuré.'], 403);
        }

        $user = DB::transaction(function () use ($validated) {
            if (User::where('role', 'admin')->whereNull('restaurant_id')->exists()) {
                return null;
            }

            return User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => $validated['password'],
                'role' => 'admin',
            ]);
        });

        if (! $user) {
            return response()->json(['message' => 'Un compte admin général existe déjà.'], 409);
        }

        Cache::forget('admin_setup_key');

        return response()->json([
            'message' => 'Compte admin général créé. Vous pouvez maintenant vous connecter.',
        ], 201);
    }

    private function ensureLocalAdminSetupRequest(Request $request): void
    {
        abort_unless(
            in_array($request->server('REMOTE_ADDR'), ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true),
            403,
            'La création du compte admin général est réservée au PC serveur. Ouvrez la page avec localhost.',
        );
    }

    public function me(Request $request)
    {
        $user = $request->user()->load('restaurant');

        return response()->json($this->userPayload($user));
    }

    public function refresh(Request $request)
    {
        $validated = $request->validate([
            'refresh' => ['required', 'string'],
        ]);
        $refreshToken = ApiToken::with('user')
            ->where('type', 'refresh')
            ->where('token_hash', hash('sha256', $validated['refresh']))
            ->where('expires_at', '>', now())
            ->first();

        if (
            ! $refreshToken
            || (! $refreshToken->user->restaurant_id && $refreshToken->user->role !== 'admin')
            || ($refreshToken->user->restaurant_id && $refreshToken->user->restaurant?->status !== 'active')
        ) {
            return response()->json(['message' => 'Jeton de renouvellement invalide ou expiré.'], 401);
        }

        $refreshToken->delete();

        return response()->json($this->issueTokens($refreshToken->user));
    }

    private function issueTokens(User $user): array
    {
        $access = Str::random(80);
        $refresh = Str::random(80);

        ApiToken::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $access),
            'type' => 'access',
            'expires_at' => now()->addHour(),
        ]);
        ApiToken::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $refresh),
            'type' => 'refresh',
            'expires_at' => now()->addDays(30),
        ]);

        return [
            'access' => $access,
            'refresh' => $refresh,
            'user' => $this->userPayload($user->load('restaurant')),
        ];
    }

    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'display_name' => $user->name,
            'role' => $user->role,
            'restaurant' => $user->restaurant,
        ];
    }
}
